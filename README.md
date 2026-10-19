# Room Jukebox (YouTube PWA)

A mobile and desktop installable web app for a shared YouTube / YouTube Music link queue. The host plays songs in YouTube's **visible, official embedded player** on the host phone or computer. Guests join by invite link or six-character code and add song links. The host can start, resume, and advance the room queue; the player advances to the next queued item after a video ends. The host uses YouTube's own player controls for volume.

This is a queueing/player prototype, not an adapter to the YouTube Music mobile app. Every queued item must be a YouTube video/song URL with a video ID. Playlist-only URLs are not yet supported. YouTube decides which videos are embeddable and may serve ads; the app does not alter the player or block ads. Playback requires the page/player to remain visible. Browser autoplay rules can require the host to tap Start/Resume. Some videos may disable embedding, be age-restricted, or be unavailable in a region.

## Firebase deployment

The app is live at **https://room-jukebox-pwa-2026.web.app** and uses the new Firebase project `room-jukebox-pwa-2026`. The project's default Realtime Database is in `us-central1`; Anonymous sign-in is enabled; and `database.rules.json` is deployed. The `.firebaserc` alias points only to this project.

This project is set up for Firebase's no-cost Spark plan. Realtime Database includes up to 1 GB stored and 10 GB/month downloaded, with a 100 simultaneous-connection limit on Spark. If the no-cost quota is exceeded, Firebase shuts off that product for the rest of the month; this project has not been linked to a billing account. See [Firebase plan details](https://firebase.google.com/pricing).

To publish later changes, install Node.js, then run `npx firebase-tools login` and `npx firebase-tools deploy --only auth,database,hosting --project room-jukebox-pwa-2026`. Keep `firebase-config.js` as public client configuration only; never put a service-account key or other server secret in the app or public repository.

Open the Hosting URL on the host and guests. On phones, use the browser's **Add to Home Screen / Install app** action if desired. Create a room on the host device, share the invite, and keep the host page visible while music plays.

For a private gathering prototype, these rules allow any signed-in guest to read room data, add a queue item as themselves, and remove their own item. Only the host can change the playing item or remove other guests' items. Anonymous sign-in limits casual writes to signed-in app identities, but invite codes are not strong authentication; don't store sensitive data in rooms. Before wider/public use, add Firebase App Check, room expiration/cleanup, abuse controls, rate limits, and moderator controls.

## Run locally

Serve this folder from `http://localhost` (or an HTTPS host) after Firebase setup, for example with `python -m http.server 8000`. Opening `index.html` directly as a `file://` URL won't work for Firebase auth, the YouTube API origin check, or the service worker.

## What the YouTube player can do

The YouTube IFrame Player API supports loading/playing videos, volume changes, queueing, and player-state events. This app uses it only for the host's selected queue item and advances when the official player reports that the video ended. A user gesture is used to start the first video; unmuted scripted playback can be blocked by mobile/desktop browser policy. The embed stays visible, displays YouTube's own controls/branding and ad experience, and does not attempt background playback. For automatic advancement, keep more than half of the player visible; if it is scrolled off-screen when a song ends, the next song waits for the host to bring the player back and tap **Play next**.

YouTube's embedded-player policy requires preserving its standard player behavior and ads, sending playback context, and not playing in a hidden/background player. Read the [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [embedded-player parameters](https://developers.google.com/youtube/player_parameters), [required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality), and [developer policy guide](https://developers.google.com/youtube/terms/developer-policies-guide) before distributing the app publicly.

## Current prototype boundaries

- Queue entries are video IDs, title text (optional), submitter, and YouTube URL.
- It doesn't use YouTube Data API search/metadata, so guests paste song links rather than search inside the app.
- One host player drives the room. Guest devices contribute; they don't start their own synced playback.
- Room queue synchronization and host/player behavior need a real multi-device test after Firebase is configured.
- This PWA can be wrapped in Tauri 2 later if a store-installed native shell is useful; the queue and player stay web-based.
