// Optional runtime override of the Supabase connection.
//
// To point this app at your own Supabase project WITHOUT editing supabase.js:
//   1. Copy this file to `config.js`.
//   2. Fill in your project URL + publishable (anon) key below.
//   3. Add `<script src="config.js"></script>` BEFORE the module script tags
//      in index.html / play.html / screen.html.
//
// The publishable key is public by design (access is governed by RLS), so it is
// safe to ship in client code. `config.js` is git-ignored.

window.WWW_CONFIG = {
  url: 'https://YOUR-PROJECT-ref.supabase.co',
  anonKey: 'sb_publishable_xxxxxxxxxxxxxxxxxxxxx',
}
