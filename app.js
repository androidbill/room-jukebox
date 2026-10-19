(() => {
  const $ = id => document.getElementById(id);
  const els = {
    setupCard: $("setupCard"), roomView: $("roomView"), connection: $("connectionPill"), setupMessage: $("setupMessage"),
    create: $("createRoomButton"), join: $("joinRoomButton"), hostName: $("hostName"), guestName: $("guestName"), joinCode: $("joinCode"),
    roomCode: $("roomCodeDisplay"), role: $("roomRole"), share: $("shareRoomButton"), leave: $("leaveRoomButton"),
    form: $("addSongForm"), searchForm: $("songSearchForm"), searchQuery: $("searchQuery"), searchYoutube: $("searchYoutubeButton"), searchMusic: $("searchMusicButton"),
    songUrl: $("songUrl"), songTitle: $("songTitle"), pasteAndAdd: $("pasteAndAddButton"), addMessage: $("addMessage"), list: $("queueList"),
    empty: $("emptyQueue"), count: $("queueCount"), hostControls: $("hostControls"), guestNotice: $("guestPlayerNotice"),
    start: $("startPlaybackButton"), skip: $("skipButton"), title: $("currentTitle"), hint: $("playerHint"), state: $("playState"),
    playerEyebrow: $("playerEyebrow"), playerFrame: $("playerFrame"), toast: $("toast"), install: $("installButton")
  };

  const state = {
    db: null, user: null, roomCode: null, roomRef: null, isHost: false, displayName: "Guest", room: null,
    queue: [], player: null, playerReady: false, playerLoading: false, apiReady: false,
    currentItemId: null, loadedItemId: null, endedItemId: null, nextNeedsGesture: false, installPrompt: null, roomListener: null,
    pendingShare: null
  };

  function setConnection(text, connected = false) {
    els.connection.classList.toggle("connected", connected);
    els.connection.lastElementChild.textContent = text;
  }

  function configured() {
    const c = window.JUKEBOX_FIREBASE_CONFIG;
    return c && c.apiKey && !c.apiKey.startsWith("REPLACE_") && !c.apiKey.startsWith("YOUR_") && c.databaseURL && !c.databaseURL.includes("REPLACE_") && c.projectId && !c.projectId.startsWith("REPLACE_");
  }

  function showMessage(target, message, error = true) {
    target.textContent = message;
    target.style.color = error ? "var(--danger)" : "var(--accent)";
  }

  function say(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    clearTimeout(say.timer);
    say.timer = setTimeout(() => els.toast.classList.add("hidden"), 2800);
  }

  function roomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return [...bytes].map(n => alphabet[n % alphabet.length]).join("");
  }

  function cleanName(raw, fallback) {
    const v = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 24);
    return v || fallback;
  }

  function parseYouTubeUrl(raw) {
    let url;
    try { url = new URL(raw.trim()); } catch { throw new Error("Paste a valid YouTube video link."); }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) {
      throw new Error("Use a youtube.com, music.youtube.com, or youtu.be link.");
    }
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
    else id = url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] || "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error("That link needs to point to one YouTube video or song, not only a playlist.");
    return { videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
  }

  function extractYouTubeUrl(raw) {
    const value = String(raw || "").trim();
    try { return parseYouTubeUrl(value).url; } catch {}
    const candidates = value.match(/https?:\/\/[^\s<>"']+/g) || [];
    for (const candidate of candidates) {
      try { return parseYouTubeUrl(candidate.replace(/[),.;!?]+$/g, "")).url; } catch {}
    }
    throw new Error("No YouTube video link found. Copy or share a link to one song/video, not a playlist.");
  }

  function openSearch(engine) {
    const query = els.searchQuery.value.trim();
    if (!query) {
      showMessage(els.addMessage, "Enter an artist, song title, or both to search.");
      els.searchQuery.focus();
      return;
    }
    const url = engine === "music"
      ? `https://music.youtube.com/search?q=${encodeURIComponent(query)}`
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    showMessage(els.addMessage, "Choose a song, copy or share its video link, then return here to add it.", false);
  }

  function loadYouTubeApi() {
    if (state.apiReady || document.querySelector("script[data-youtube-api]")) return;
    window.onYouTubeIframeAPIReady = () => {
      state.apiReady = true;
      if (state.isHost) createPlayer();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.dataset.youtubeApi = "true";
    document.head.appendChild(script);
  }

  function createPlayer() {
    if (!state.apiReady || !state.isHost || state.player) return;
    state.playerLoading = true;
    state.player = new YT.Player("youtubePlayer", {
      width: "100%", height: "100%",
      playerVars: { playsinline: 1, controls: 1, enablejsapi: 1, origin: location.origin, rel: 0 },
      events: {
        onReady: () => {
          state.playerReady = true;
          state.playerLoading = false;
          if (state.room?.currentItem) {
            state.loadedItemId = state.room.currentItem.id;
            state.player.cueVideoById(state.room.currentItem.videoId);
            els.hint.textContent = "Current room song is cued. Tap Resume playback to continue.";
          }
          renderCurrent();
        },
        onStateChange: event => {
          if (event.data === YT.PlayerState.PLAYING) {
            els.state.textContent = "Playing";
            const data = state.player.getVideoData?.();
            if (data?.title) {
              els.title.textContent = data.title;
              const current = state.room?.currentItem;
              if (state.isHost && current && current.id === state.loadedItemId && !current.title) {
                state.roomRef.child("currentItem").update({ title: data.title }).catch(() => {});
              }
            }
          } else if (event.data === YT.PlayerState.PAUSED) els.state.textContent = "Paused";
          else if (event.data === YT.PlayerState.BUFFERING) els.state.textContent = "Loading";
          else if (event.data === YT.PlayerState.ENDED) {
            els.state.textContent = "Song ended";
            if (state.isHost && state.currentItemId && state.endedItemId !== state.currentItemId) {
              state.endedItemId = state.currentItemId;
              if (playerIsVisible()) advanceQueue(false);
              else {
                state.nextNeedsGesture = true;
                els.state.textContent = "Ready for next";
                els.hint.textContent = "The player is off screen, so the next video is ready but not started. Scroll up and tap Play next.";
                els.start.textContent = "Play next";
              }
            }
          } else if (event.data === YT.PlayerState.CUED) els.state.textContent = "Ready";
        },
        onAutoplayBlocked: () => {
          els.state.textContent = "Tap to play";
          els.hint.textContent = "Your browser blocked scripted playback. Tap Start/Resume playback or the player’s Play button.";
        },
        onError: event => {
          els.state.textContent = "Unavailable";
          els.hint.textContent = `YouTube could not play this video (player error ${event.data}). Remove it or choose another version.`;
        }
      }
    });
  }

  function renderQueue() {
    els.list.replaceChildren();
    els.count.textContent = String(state.queue.length);
    els.empty.classList.toggle("hidden", state.queue.length > 0);
    state.queue.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "queue-item";
      const number = document.createElement("span");
      number.className = "queue-index";
      number.textContent = String(index + 1).padStart(2, "0");
      const details = document.createElement("div");
      details.className = "queue-details";
      const title = document.createElement("div");
      title.className = "queue-title";
      title.textContent = item.title || `YouTube video ${item.videoId}`;
      const sub = document.createElement("div");
      sub.className = "queue-sub";
      sub.textContent = `Added by ${item.addedBy || "Guest"}`;
      details.append(title, sub);
      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.alignItems = "center";
      const link = document.createElement("a");
      link.className = "queue-link";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Open ↗";
      link.setAttribute("aria-label", `Open ${title.textContent} on YouTube`);
      actions.append(link);
      if (state.isHost || item.addedByUid === state.user?.uid) {
        const remove = document.createElement("button");
        remove.className = "remove-button";
        remove.type = "button";
        remove.title = "Remove from queue";
        remove.setAttribute("aria-label", "Remove from queue");
        remove.textContent = "×";
        remove.addEventListener("click", () => removeQueueItem(item.id));
        actions.append(remove);
      }
      li.append(number, details, actions);
      els.list.append(li);
    });
    els.skip.disabled = !state.isHost || state.queue.length === 0;
    els.start.disabled = !state.isHost || (!state.playerReady && !state.room?.currentItem && state.queue.length === 0);
  }

  function renderCurrent() {
    const current = state.room?.currentItem;
    state.currentItemId = current?.id || null;
    if (!current) {
      els.title.textContent = "Ready when you are";
      els.state.textContent = "Waiting";
      els.hint.textContent = "Add a song, then tap Start playback. Keep this page visible while it plays.";
      els.start.textContent = "Start playback";
    } else {
      els.title.textContent = current.title || `YouTube video ${current.videoId}`;
      els.state.textContent = "Queued to play";
      els.hint.textContent = "The host controls playback. The room advances to the next queued song when this one ends.";
      els.start.textContent = "Resume playback";
      if (state.isHost && state.playerReady && state.loadedItemId !== current.id) {
        state.loadedItemId = current.id;
        state.endedItemId = null;
        state.player.cueVideoById(current.videoId);
      }
    }
    if (state.nextNeedsGesture && state.queue.length > 0) els.start.textContent = "Play next";
    renderQueue();
  }

  function showRoom() {
    els.setupCard.classList.add("hidden");
    els.roomView.classList.remove("hidden");
    els.roomCode.textContent = state.roomCode;
    els.role.textContent = state.isHost ? "HOST ROOM" : "GUEST ROOM";
    els.playerEyebrow.textContent = state.isHost ? "HOST PLAYER" : "NOW PLAYING";
    els.hostControls.classList.toggle("hidden", !state.isHost);
    els.guestNotice.classList.toggle("hidden", state.isHost);
    els.playerFrame.classList.toggle("hidden", !state.isHost);
    if (state.isHost) loadYouTubeApi();
  }

  function subscribeRoom(ref) {
    if (state.roomRef && state.roomListener) state.roomRef.off("value", state.roomListener);
    state.roomRef = ref;
    state.roomListener = snapshot => {
      const value = snapshot.val();
      if (!value) {
        showMessage(els.setupMessage, "This room has ended or no longer exists.");
        leaveRoom(false);
        return;
      }
      state.room = value;
      state.isHost = value.hostUid === state.user.uid;
      state.displayName = state.isHost ? (value.hostName || "Host") : state.displayName;
      state.queue = Object.entries(value.queue || {}).map(([id, item]) => ({ ...item, id })).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0) || a.id.localeCompare(b.id));
      showRoom();
      renderCurrent();
      setConnection("Room connected", true);
      if (state.pendingShare) addPendingShare();
      if (state.isHost && state.apiReady && !state.player) createPlayer();
    };
    ref.on("value", state.roomListener, error => showMessage(els.setupMessage, `Could not read the room: ${error.message}`));
  }

  async function createRoom() {
    if (!state.user || !state.db) return;
    const button = els.create;
    button.disabled = true;
    showMessage(els.setupMessage, "Creating your room…", false);
    try {
      let code;
      let ref;
      let created = false;
      for (let attempt = 0; attempt < 4 && !created; attempt++) {
        code = roomCode();
        ref = state.db.ref(`rooms/${code}`);
        const result = await ref.transaction(existing => existing === null ? {
          hostUid: state.user.uid,
          hostName: cleanName(els.hostName.value, "Host"),
          createdAt: firebase.database.ServerValue.TIMESTAMP,
          currentItem: null,
          queue: {}
        } : undefined, undefined, false);
        created = result.committed;
      }
      if (!created || !ref) throw new Error("Could not reserve a room code. Please try again.");
      state.roomCode = code;
      localStorage.setItem("jukeboxRoomCode", code);
      state.displayName = cleanName(els.hostName.value, "Host");
      history.replaceState({}, "", `${location.pathname}?room=${code}`);
      subscribeRoom(ref);
    } catch (error) {
      showMessage(els.setupMessage, error.message || "Could not create room.");
    } finally { button.disabled = false; }
  }

  async function joinRoom(codeRaw) {
    if (!state.user || !state.db) return;
    const code = codeRaw.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
      showMessage(els.setupMessage, "Enter the six-character room code.");
      return;
    }
    const button = els.join;
    button.disabled = true;
    showMessage(els.setupMessage, "Joining room…", false);
    try {
      const ref = state.db.ref(`rooms/${code}`);
      const snapshot = await ref.once("value");
      if (!snapshot.exists()) throw new Error("Room not found. Check the code with your host.");
      state.roomCode = code;
      localStorage.setItem("jukeboxRoomCode", code);
      state.displayName = cleanName(els.guestName.value, "Guest");
      history.replaceState({}, "", `${location.pathname}?room=${code}`);
      subscribeRoom(ref);
    } catch (error) { showMessage(els.setupMessage, error.message || "Could not join room."); }
    finally { button.disabled = false; }
  }

  async function queueSong(rawUrl, titleOverride = "") {
    if (!state.roomRef || !state.user) {
      showMessage(els.addMessage, "Join or create a room before adding a song.");
      return false;
    }
    let parsed;
    try { parsed = parseYouTubeUrl(extractYouTubeUrl(rawUrl)); }
    catch (error) { showMessage(els.addMessage, error.message); return false; }
    const submit = els.form.querySelector("button[type=submit]");
    submit.disabled = true;
    showMessage(els.addMessage, "Adding to the room queue…", false);
    const itemRef = state.roomRef.child("queue").push();
    const item = {
      videoId: parsed.videoId,
      url: parsed.url,
      title: String(titleOverride || els.songTitle.value).trim().slice(0, 100) || "",
      addedBy: state.displayName,
      addedByUid: state.user.uid,
      addedAt: firebase.database.ServerValue.TIMESTAMP
    };
    try {
      await itemRef.set(item);
      els.form.reset();
      showMessage(els.addMessage, "Added to the queue.", false);
      return true;
    } catch (error) { showMessage(els.addMessage, `Could not add song: ${error.message}`); return false; }
    finally { submit.disabled = false; }
  }

  async function addSong(event) {
    event.preventDefault();
    await queueSong(els.songUrl.value);
  }

  async function pasteAndAdd() {
    if (!state.roomRef || !state.user) {
      showMessage(els.addMessage, "Join or create a room before adding a song.");
      return;
    }
    if (!navigator.clipboard?.readText) {
      showMessage(els.addMessage, "Clipboard access is unavailable here. Paste the link into the box below.");
      els.songUrl.focus();
      return;
    }
    els.pasteAndAdd.disabled = true;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("The clipboard is empty. Copy a YouTube song link first.");
      await queueSong(text);
    } catch (error) {
      showMessage(els.addMessage, `${error.message || "Clipboard access was blocked."} Paste the copied link into the box below and tap Add link.`);
      els.songUrl.focus();
    } finally { els.pasteAndAdd.disabled = false; }
  }

  async function addPendingShare() {
    const pending = state.pendingShare;
    if (!pending || !state.roomRef || !state.user) return;
    state.pendingShare = null;
    await queueSong(pending.text, pending.title);
  }

  async function removeQueueItem(itemId) {
    const item = state.queue.find(q => q.id === itemId);
    if (!item || (!state.isHost && item.addedByUid !== state.user?.uid)) return;
    try { await state.roomRef.child(`queue/${itemId}`).remove(); }
    catch (error) { say(`Could not remove: ${error.message}`); }
  }

  async function startPlayback() {
    if (!state.isHost || !state.playerReady) {
      say("Wait for the YouTube player to finish loading.");
      return;
    }
    const current = state.room?.currentItem;
    if (state.nextNeedsGesture) {
      advanceQueue(true);
      return;
    }
    if (current) {
      state.endedItemId = null;
      state.player.playVideo();
      return;
    }
    const next = state.queue[0];
    if (!next) { say("Add a song to the queue first."); return; }
    // Call from the user's tap so mobile browsers can grant playback activation.
    state.loadedItemId = next.id;
    state.endedItemId = null;
    state.player.loadVideoById(next.videoId);
    const item = { id: next.id, videoId: next.videoId, url: next.url, title: next.title || "", addedBy: next.addedBy };
    try { await state.roomRef.update({ currentItem: item, [`queue/${next.id}`]: null }); }
    catch (error) { els.hint.textContent = `Playback started, but the shared room could not update: ${error.message}`; }
  }

  function playerIsVisible() {
    const rect = els.playerFrame.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    const area = rect.width * rect.height;
    return area > 0 && (width * height) / area > 0.5;
  }

  async function advanceQueue(fromGesture = false) {
    if (!state.isHost || !state.roomRef) return;
    const next = state.queue[0];
    if (!next) {
      state.nextNeedsGesture = false;
      try { await state.roomRef.child("currentItem").set(null); }
      catch (error) { say(`Could not finish the queue: ${error.message}`); }
      return;
    }
    const item = { id: next.id, videoId: next.videoId, url: next.url, title: next.title || "", addedBy: next.addedBy };
    state.loadedItemId = next.id;
    state.endedItemId = null;
    state.nextNeedsGesture = false;
    if (state.playerReady && (fromGesture || playerIsVisible())) state.player.loadVideoById(next.videoId);
    else state.nextNeedsGesture = true;
    try {
      await state.roomRef.update({ currentItem: item, [`queue/${next.id}`]: null });
      if (state.nextNeedsGesture) {
        els.state.textContent = "Ready for next";
        els.start.textContent = "Play next";
      }
    } catch (error) {
      state.endedItemId = null;
      state.nextNeedsGesture = false;
      say(`Could not advance: ${error.message}`);
    }
  }

  async function leaveRoom(clearUrl = true) {
    if (state.roomRef && state.roomListener) state.roomRef.off("value", state.roomListener);
    state.roomRef = null;
    state.roomListener = null;
    state.roomCode = null;
    localStorage.removeItem("jukeboxRoomCode");
    state.room = null;
    state.queue = [];
    state.isHost = false;
    state.currentItemId = null;
    state.loadedItemId = null;
    state.endedItemId = null;
    if (state.player) {
      try { state.player.destroy(); } catch {}
      state.player = null;
      state.playerReady = false;
      state.playerLoading = false;
      $("youtubePlayer").replaceWith(Object.assign(document.createElement("div"), { id: "youtubePlayer" }));
    }
    els.roomView.classList.add("hidden");
    els.setupCard.classList.remove("hidden");
    if (clearUrl) history.replaceState({}, "", location.pathname);
  }

  async function shareRoom() {
    const url = new URL(location.href);
    url.searchParams.set("room", state.roomCode);
    const text = `Join my Room Jukebox: ${url.toString()} (room ${state.roomCode})`;
    try {
      if (navigator.share) await navigator.share({ title: "Join my jukebox", text, url: url.toString() });
      else {
        await navigator.clipboard.writeText(text);
        say("Room invite copied.");
      }
    } catch (error) {
      if (error.name !== "AbortError") say("Could not share. Give guests the room code: " + state.roomCode);
    }
  }

  function initPwa() {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      state.installPrompt = event;
      els.install.classList.remove("hidden");
    });
    els.install.addEventListener("click", async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      els.install.classList.add("hidden");
    });
  }

  function boot() {
    initPwa();
    els.create.addEventListener("click", createRoom);
    els.join.addEventListener("click", () => joinRoom(els.joinCode.value));
    els.joinCode.addEventListener("input", () => { els.joinCode.value = els.joinCode.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6); });
    els.searchForm.addEventListener("submit", event => { event.preventDefault(); openSearch("youtube"); });
    els.form.addEventListener("submit", addSong);
    els.searchYoutube.addEventListener("click", () => openSearch("youtube"));
    els.searchMusic.addEventListener("click", () => openSearch("music"));
    els.pasteAndAdd.addEventListener("click", pasteAndAdd);
    els.start.addEventListener("click", startPlayback);
    els.skip.addEventListener("click", advanceQueue);
    els.share.addEventListener("click", shareRoom);
    els.leave.addEventListener("click", () => leaveRoom());

    if (!configured() || !window.firebase) {
      setConnection("Setup needed");
      showMessage(els.setupMessage, "One-time setup needed: connect this app to Firebase. Follow the short setup guide in README.md.");
      els.create.disabled = true;
      els.join.disabled = true;
      return;
    }
    try {
      firebase.initializeApp(window.JUKEBOX_FIREBASE_CONFIG);
      state.db = firebase.database();
      firebase.auth().signInAnonymously().then(credential => {
        state.user = credential.user;
        setConnection("Ready to make a room", true);
        const params = new URLSearchParams(location.search);
        const sharedText = params.get("url") || params.get("text");
        if (sharedText) state.pendingShare = { text: sharedText, title: params.get("title") || "" };
        const code = params.get("room") || localStorage.getItem("jukeboxRoomCode");
        if (code) { els.joinCode.value = code.toUpperCase(); joinRoom(code); }
      }).catch(error => {
        setConnection("Sign-in error");
        showMessage(els.setupMessage, `Could not sign in to the room service: ${error.message}`);
      });
    } catch (error) {
      setConnection("Setup error");
      showMessage(els.setupMessage, `Firebase setup is incomplete: ${error.message}`);
    }
  }

  boot();
})();
