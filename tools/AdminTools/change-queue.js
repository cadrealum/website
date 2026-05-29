/* ChangeQueue — shared pending-actions buffer for the admin tools.

   Any admin tool that wants to stage a write pushes here; the Show Changes
   panel + the sidebar Commit button subscribe and update on every modification.

   On commit, ChangeQueue.toBatchChanges() yields the changes[] array that
   ghBatchCommit() consumes. Action shapes:

       { type: 'createFolder', path }
       { type: 'uploadFile',   path, base64, name?, size? }
       { type: 'deleteFile',   path, sha }
       { type: 'deleteFolder', path, containedFiles: [{path, sha}, …] }

   To add a new action type later: extend the switches in labelFor /
   summarize / toBatchChanges below. (If a third+ tool needs more types,
   refactor to a type registry then — for now in-place dispatch keeps it
   obvious.)

   Loaded on tools/post-generator-admin.html after admin-tool-manager.js,
   before any concrete admin tool script. */

const ChangeQueue = (function () {
    const items = [];
    const subs = [];
    const commitSubs = [];

    function emit() {
        subs.forEach(function(fn) {
            try { fn(); } catch (e) { console.error('ChangeQueue subscriber', e); }
        });
    }

    function emitCommitSuccess(result) {
        commitSubs.forEach(function(fn) {
            try { fn(result); } catch (e) { console.error('ChangeQueue commit subscriber', e); }
        });
    }

    function labelFor(a) {
        if (a.type === 'createFolder')    return 'Create folder: ' + a.path;
        if (a.type === 'uploadFile')      return 'Upload: ' + a.path;
        if (a.type === 'deleteFile')      return 'Delete: ' + a.path;
        if (a.type === 'deleteFolder')    return 'Delete folder: ' + a.path + '/ (' + a.containedFiles.length + ' files)';
        if (a.type === 'publishHtml')     return 'Publish: ' + a.path;
        if (a.type === 'unpublishHtml')   return 'Unpublish: ' + a.path;
        if (a.type === 'updateBlogIndex') return 'Update blog index: ' + a.path;
        return a.type + ': ' + (a.path || '?');
    }

    function summarize() {
        let creates = 0, uploads = 0, deletes = 0, publishes = 0, unpublishes = 0;
        items.forEach(function(a) {
            if      (a.type === 'createFolder')    creates++;
            else if (a.type === 'uploadFile')      uploads++;
            else if (a.type === 'deleteFile')      deletes++;
            else if (a.type === 'deleteFolder')    deletes += a.containedFiles.length;
            else if (a.type === 'publishHtml')     publishes++;
            else if (a.type === 'unpublishHtml')   unpublishes++;
            // updateBlogIndex is bundled with publishes/unpublishes — don't count separately
        });
        const parts = [];
        if (publishes)   parts.push('+' + publishes   + ' blog'    + (publishes   === 1 ? '' : 's'));
        if (unpublishes) parts.push('−' + unpublishes + ' blog'    + (unpublishes === 1 ? '' : 's'));
        if (uploads)     parts.push('+' + uploads     + ' upload'  + (uploads     === 1 ? '' : 's'));
        if (creates)     parts.push('+' + creates     + ' folder'  + (creates     === 1 ? '' : 's'));
        if (deletes)     parts.push('−' + deletes     + ' deletion'+ (deletes     === 1 ? '' : 's'));
        return parts.join(', ') || 'no changes';
    }

    function toBatchChanges() {
        const out = [];
        items.forEach(function(a) {
            if (a.type === 'createFolder') {
                out.push({ op: 'put', path: a.path + '/.gitkeep', content: '' });
            } else if (a.type === 'uploadFile') {
                out.push({ op: 'putB64', path: a.path, base64: a.base64 });
            } else if (a.type === 'deleteFile' || a.type === 'unpublishHtml') {
                out.push({ op: 'delete', path: a.path });
            } else if (a.type === 'deleteFolder') {
                a.containedFiles.forEach(function(f) {
                    out.push({ op: 'delete', path: f.path });
                });
            } else if (a.type === 'publishHtml' || a.type === 'updateBlogIndex') {
                out.push({ op: 'put', path: a.path, content: a.content });
            }
        });
        return out;
    }

    // Undoing a publishHtml / unpublishHtml needs to undo its effect on the
    // bundled updateBlogIndex too — otherwise removing the HTML action leaves
    // a stale JSON entry (or missing one) referencing the wrong state.
    function cleanupAfterRemoval(removed) {
        if (!removed) return;
        if (removed.type !== 'publishHtml' && removed.type !== 'unpublishHtml') return;

        const idx = items.findIndex(function(a) { return a.type === 'updateBlogIndex'; });
        if (idx === -1) return;
        const upd = items[idx];
        let json;
        try { json = JSON.parse(upd.content); }
        catch (_) { return; }

        if (removed.type === 'publishHtml') {
            // Remove the entry this publishHtml added (or moved into target)
            const href = removed.path;
            if (Array.isArray(json[removed.target])) {
                const ei = json[removed.target].findIndex(function(e) { return e && e.href === href; });
                if (ei >= 0) json[removed.target].splice(ei, 1);
            }
            // If it was an overwrite, restore the original entry to its original array
            if (removed.originalEntry && removed.originalTarget) {
                if (!Array.isArray(json[removed.originalTarget])) json[removed.originalTarget] = [];
                json[removed.originalTarget].push(removed.originalEntry);
            }
        } else if (removed.type === 'unpublishHtml') {
            // Restore the entry this unpublishHtml removed
            if (removed.originalEntry && removed.originalTarget) {
                if (!Array.isArray(json[removed.originalTarget])) json[removed.originalTarget] = [];
                json[removed.originalTarget].push(removed.originalEntry);
            }
        }

        // No more publish/unpublish actions in the queue → JSON change is moot
        const stillTouching = items.some(function(a) {
            return a.type === 'publishHtml' || a.type === 'unpublishHtml';
        });
        if (!stillTouching) {
            items.splice(idx, 1);
            return;
        }
        upd.content = JSON.stringify(json, null, 4);
    }

    return {
        add:       function(a) { items.push(a); emit(); },
        removeAt:  function(i) {
            if (i < 0 || i >= items.length) return;
            const removed = items.splice(i, 1)[0];
            cleanupAfterRemoval(removed);
            emit();
        },
        pop:       function() {
            if (!items.length) return;
            // Skip past trailing updateBlogIndex items — they're derived
            // bookkeeping, not user-visible work. Pop the last "real" action
            // instead so Undo behaves intuitively.
            let i = items.length - 1;
            while (i >= 0 && items[i].type === 'updateBlogIndex') i--;
            if (i < 0) { items.pop(); emit(); return; }
            const removed = items.splice(i, 1)[0];
            cleanupAfterRemoval(removed);
            emit();
        },
        clear:     function() { if (items.length) { items.length = 0; emit(); } },
        replaceOrAdd: function(predicate, item) {
            for (let i = 0; i < items.length; i++) {
                if (predicate(items[i])) { items[i] = item; emit(); return; }
            }
            items.push(item);
            emit();
        },
        list:      function() { return items.slice(); },
        get length() { return items.length; },
        subscribe: function(fn) {
            subs.push(fn);
            return function unsub() {
                const i = subs.indexOf(fn);
                if (i >= 0) subs.splice(i, 1);
            };
        },
        // Subscribe to successful commits. Each subscriber receives the
        // ghBatchCommit result (commitSha, treeSha, retried). Tools use this
        // to refresh their server-state caches.
        onCommitSuccess: function(fn) {
            commitSubs.push(fn);
            return function unsub() {
                const i = commitSubs.indexOf(fn);
                if (i >= 0) commitSubs.splice(i, 1);
            };
        },
        // Emit a commit-success event. Called by Show Changes after a
        // successful ghBatchCommit. Tools should not call this directly.
        notifyCommitSuccess: emitCommitSuccess,
        labelFor:        labelFor,
        summarize:       summarize,
        toBatchChanges:  toBatchChanges
    };
})();
