// PebbleKit JS ("the host app") for the BMO watchapp.
//
// Flow: watch dictates a prompt and sends it here as PROMPT. We call the
// Google Gemini API with the user's stored API key, try to speak the
// answer out loud (only possible where pkjs runs in a WebView with the Web
// Speech API, e.g. Android — there is no such capability on iOS or in this
// emulator), and tell the watch how long to show its "speaking" face via
// DURATION. On any failure we send ERR instead so the watch can recover.

var Clay = require("@rebble/clay");
var clayConfig = require("./config.json");
// autoHandleEvents: false — Clay's default behavior relays every setting to
// the watch via AppMessage, but the API key only needs to live on the phone
// (the watch never talks to Gemini directly), so we handle the events
// ourselves and just keep the value in localStorage.
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

var STORAGE_KEY = "geminiApiKey";
var GEMINI_MODEL = "gemini-2.0-flash";
var SPEAK_GRACE_MS = 5000; // how long to keep BMO's face up after speaking ends

function log(msg) {
	console.log("[BMO] " + msg);
}

Pebble.addEventListener("ready", function () {
	log("PebbleKit JS ready.");
	// The watch's AppMessage outbox doesn't become writable until the phone
	// side has kicked off the session, so send a no-op ping first.
	Pebble.sendAppMessage({ HELLO: 1 }, function () {}, function () {
		log("Handshake HELLO failed to send.");
	});
});

Pebble.addEventListener("showConfiguration", function () {
	// Pre-fill the form with whatever key is already saved, so the user can
	// see/edit it instead of re-entering it blind every time.
	clay.setSettings("apiKey", localStorage.getItem(STORAGE_KEY) || "");
	Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener("webviewclosed", function (e) {
	if (!e || !e.response) return;
	// With convert:false, each field comes back as { value: ... } rather
	// than a plain value — unwrap it.
	var settings = clay.getSettings(e.response, false);
	var raw = settings && settings.apiKey;
	var apiKey = raw && typeof raw === "object" ? raw.value : raw;
	if (typeof apiKey === "string") {
		localStorage.setItem(STORAGE_KEY, apiKey.trim());
		log("Saved Gemini API key.");
	}
});

Pebble.addEventListener("appmessage", function (e) {
	var payload = e.payload || {};
	if (typeof payload.PROMPT === "string" && payload.PROMPT.length > 0) {
		handlePrompt(payload.PROMPT);
	}
});

function handlePrompt(promptText) {
	var apiKey = localStorage.getItem(STORAGE_KEY);
	if (!apiKey) {
		log("No Gemini API key configured. Open the app settings on your phone to add one.");
		sendError();
		return;
	}

	var url =
		"https://generativelanguage.googleapis.com/v1beta/models/" +
		GEMINI_MODEL +
		":generateContent?key=" +
		encodeURIComponent(apiKey);

	var body = JSON.stringify({
		contents: [{ parts: [{ text: promptText }] }],
	});

	var xhr = new XMLHttpRequest();
	xhr.open("POST", url);
	xhr.setRequestHeader("Content-Type", "application/json");
	xhr.timeout = 20000;
	xhr.onload = function () {
		if (xhr.status >= 200 && xhr.status < 300) {
			var answer = extractAnswer(xhr.responseText);
			if (answer) {
				speakAndNotify(answer);
			} else {
				log("Gemini response had no answer text: " + xhr.responseText);
				sendError();
			}
		} else {
			log("Gemini request failed (" + xhr.status + "): " + xhr.responseText);
			sendError();
		}
	};
	xhr.onerror = function () {
		log("Network error contacting Gemini.");
		sendError();
	};
	xhr.ontimeout = function () {
		log("Gemini request timed out.");
		sendError();
	};
	xhr.send(body);
}

function extractAnswer(responseText) {
	try {
		var data = JSON.parse(responseText);
		return data.candidates[0].content.parts[0].text;
	} catch (e) {
		return null;
	}
}

function estimateSpeechMs(text) {
	var words = text.split(/\s+/).filter(function (w) { return w.length > 0; }).length;
	var ms = (words / 150) * 60000; // ~150 words/minute
	return Math.max(2500, Math.min(ms, 25000));
}

function speakAndNotify(answer) {
	var totalMs = estimateSpeechMs(answer) + SPEAK_GRACE_MS;

	// Only real on Android, where pkjs runs in a WebView with Web Speech
	// support. Elsewhere (iOS, this emulator) there is no speaker output,
	// so the watch just shows BMO's face for the estimated duration.
	if (typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined") {
		try {
			var utterance = new SpeechSynthesisUtterance(answer);
			speechSynthesis.speak(utterance);
		} catch (err) {
			log("speechSynthesis failed: " + err);
		}
	}

	Pebble.sendAppMessage({ DURATION: totalMs }, function () {}, function () {
		log("Failed to send DURATION to watch.");
	});
}

function sendError() {
	Pebble.sendAppMessage({ ERR: 1 }, function () {}, function () {
		log("Failed to send ERR to watch.");
	});
}
