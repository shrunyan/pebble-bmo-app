import Poco from "commodetto/Poco";
import Button from "pebble/button";
import Dictation from "pebble/dictation";
import Message from "pebble/message";

console.log("Hello, BMO.");

const render = new Poco(screen);

// Colors sampled from the BMO poster reference
const bodyTeal    = render.makeColor(27, 187, 177);
const faceMint    = render.makeColor(170, 255, 170);
const black       = render.makeColor(0, 0, 0);
const mouthWhite  = render.makeColor(249, 248, 247);
const mouthDark   = render.makeColor(15, 94, 75);
const speakerDk   = render.makeColor(15, 94, 75);
const navyDot     = render.makeColor(3, 82, 147);
const yellow      = render.makeColor(252, 214, 107);
const skyBlue     = render.makeColor(83, 199, 226);
const smallGreen  = render.makeColor(122, 193, 115);
const coralRed    = render.makeColor(240, 84, 87);
const navyPill    = render.makeColor(16, 96, 159);
const bmoCyan     = render.makeColor(120, 235, 224);
const timeWhite   = render.makeColor(255, 255, 255);
const spinnerBase = render.makeColor(15, 94, 75);

const timeFont = new render.Font("Leco-Bold", 26); // includes AM/PM glyphs
const dateFont = new render.Font("Gothic-Bold", 14);
const wordFont = new render.Font("Gothic-Bold", 18);
const statusFont = new render.Font("Gothic-Bold", 14);

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// The button used to talk to BMO. Hold it to dictate, release to send.
const TALK_BUTTON = "select";

// Ask -> Listening -> Loading -> Speaking -> (5s) -> Ask, or -> Error -> Ask.
let appState = "TIME"; // TIME | LISTENING | LOADING | SPEAKING | ERROR
let blinkClosed = false;
let talkOpen = false;
let spinAngle = 0;

let stateTimer = null;
let spinnerTimer = null;
let talkTimer = null;
let blinkTimer = null;

function layout() {
	const w = render.width;
	const h = render.height;

	const faceW = Math.round(w * 0.84);
	const faceH = Math.round(h * 0.33);
	const faceX = Math.round((w - faceW) / 2);
	const faceY = Math.round(h * 0.04);

	const speakerY = faceY + faceH + Math.round(h * 0.035);
	const speakerH = Math.max(6, Math.round(h * 0.04));

	const controlsY = speakerY + speakerH + Math.round(h * 0.03);
	const controlsH = Math.round(h * 0.23);

	const timeY = controlsY + controlsH + Math.round(h * 0.045);

	return { w, h, faceX, faceY, faceW, faceH, speakerY, speakerH, controlsY, controlsH, timeY };
}

function fillTriangleUp(color, cx, topY, halfBase, heightPx) {
	for (let i = 0; i <= heightPx; i++) {
		const hw = (halfBase * i) / heightPx;
		render.fillRectangle(color, Math.round(cx - hw), topY + i, Math.max(1, Math.round(hw * 2)), 1);
	}
}

function drawCross(cx, cy, armLen, thick, color) {
	const o = 2;
	render.drawRoundRect(cx - thick / 2 - o, cy - armLen / 2 - o, thick + o * 2, armLen + o * 2, black, thick / 2 + o, 0b1111);
	render.drawRoundRect(cx - armLen / 2 - o, cy - thick / 2 - o, armLen + o * 2, thick + o * 2, black, thick / 2 + o, 0b1111);
	render.drawRoundRect(cx - thick / 2, cy - armLen / 2, thick, armLen, color, thick / 2, 0b1111);
	render.drawRoundRect(cx - armLen / 2, cy - thick / 2, armLen, thick, color, thick / 2, 0b1111);
}

function drawDot(cx, cy, r, color) {
	render.drawCircle(black, cx, cy, r + 2, 0, 360);
	render.drawCircle(color, cx, cy, r, 0, 360);
}

function drawPill(cx, cy, w, h, color) {
	const o = 2;
	render.drawRoundRect(cx - w / 2 - o, cy - h / 2 - o, w + o * 2, h + o * 2, black, h / 2 + o, 0b1111);
	render.drawRoundRect(cx - w / 2, cy - h / 2, w, h, color, h / 2, 0b1111);
}

function drawTriangle(cx, topY, halfBase, heightPx, color) {
	fillTriangleUp(black, cx, topY - 2, halfBase + 3, heightPx + 4);
	fillTriangleUp(color, cx, topY, halfBase, heightPx);
}

// Normal face: open eyes (or a blink line) and a big open grin.
function drawFace(L, closedEyes, talkFrame) {
	const cx = L.faceX + L.faceW / 2;
	const eyeY = L.faceY + L.faceH * 0.43;
	const eyeDX = L.faceW * 0.27;
	const eyeR = Math.max(3, L.faceW * 0.028);

	if (closedEyes) {
		render.drawLine(cx - eyeDX - eyeR, eyeY, cx - eyeDX + eyeR, eyeY, black, 3);
		render.drawLine(cx + eyeDX - eyeR, eyeY, cx + eyeDX + eyeR, eyeY, black, 3);
	} else {
		render.drawCircle(black, cx - eyeDX, eyeY, eyeR, 0, 360);
		render.drawCircle(black, cx + eyeDX, eyeY, eyeR, 0, 360);
	}

	// Big open grin: black outline pill, white teeth band on top, dark mouth below.
	// While "talking", the mouth pulses smaller/bigger.
	const mouthY = L.faceY + L.faceH * 0.71;
	const mouthW = L.faceW * (talkFrame ? 0.18 : 0.24);
	const mouthH = L.faceH * (talkFrame ? 0.16 : 0.27);
	const whiteFrac = 0.3;
	render.drawRoundRect(cx - mouthW / 2 - 2, mouthY - mouthH / 2 - 2, mouthW + 4, mouthH + 4, black, mouthH / 2 + 2, 0b1111);
	render.drawRoundRect(cx - mouthW / 2, mouthY - mouthH / 2, mouthW, mouthH, mouthWhite, mouthH / 2, 0b1111);
	render.fillRectangle(mouthDark, cx - mouthW / 2, mouthY - mouthH / 2 + mouthH * whiteFrac, mouthW, mouthH * (1 - whiteFrac));
}

// Error face: X X eyes, flat mouth.
function drawErrorFace(L) {
	const cx = L.faceX + L.faceW / 2;
	const eyeY = L.faceY + L.faceH * 0.43;
	const eyeDX = L.faceW * 0.27;
	const eyeR = Math.max(3, L.faceW * 0.032);

	[-1, 1].forEach((side) => {
		const ex = cx + side * eyeDX;
		render.drawLine(ex - eyeR, eyeY - eyeR, ex + eyeR, eyeY + eyeR, coralRed, 3);
		render.drawLine(ex - eyeR, eyeY + eyeR, ex + eyeR, eyeY - eyeR, coralRed, 3);
	});

	const mouthY = L.faceY + L.faceH * 0.71;
	const mouthW = L.faceW * 0.2;
	render.drawLine(cx - mouthW / 2, mouthY, cx + mouthW / 2, mouthY, black, 3);
}

// Loading spinner: a rotating arc inside the face.
function drawSpinner(L) {
	const cx = L.faceX + L.faceW / 2;
	const cy = L.faceY + L.faceH / 2;
	const r = Math.min(L.faceW, L.faceH) * 0.24;
	render.drawCircle(spinnerBase, cx, cy, r, 0, 360);
	render.drawCircle(coralRed, cx, cy, r, spinAngle, spinAngle + 100);
	render.drawCircle(faceMint, cx, cy, r * 0.55, 0, 360);
}

function drawSpeaker(L) {
	const barW = L.faceW * 0.6;
	render.drawRoundRect(L.faceX, L.speakerY, barW, L.speakerH, speakerDk, L.speakerH / 2, 0b1111);
	drawDot(L.faceX + L.faceW - L.speakerH * 0.9, L.speakerY + L.speakerH / 2, L.speakerH * 0.55, navyDot);
}

function drawControls(L) {
	const row1Y = L.controlsY + L.controlsH * 0.28;
	const row2Y = L.controlsY + L.controlsH * 0.75;

	// yellow cross (d-pad), left
	const crossCX = L.faceX + L.faceW * 0.2;
	const crossArm = L.controlsH * 0.42;
	drawCross(crossCX, row1Y, crossArm, crossArm * 0.4, yellow);

	// blue triangle, right of cross
	const triCX = L.faceX + L.faceW * 0.62;
	const triSize = L.controlsH * 0.42;
	drawTriangle(triCX, row1Y - triSize / 2, triSize / 2, triSize, skyBlue);

	// small green dot, upper-right
	drawDot(L.faceX + L.faceW * 0.92, row1Y + L.controlsH * 0.05, L.controlsH * 0.09, smallGreen);

	// two navy pill buttons, bottom-left
	const pillW = L.faceW * 0.24;
	const pillH = L.controlsH * 0.16;
	drawPill(L.faceX + L.faceW * 0.14, row2Y, pillW, pillH, navyPill);
	drawPill(L.faceX + L.faceW * 0.42, row2Y, pillW, pillH, navyPill);

	// red circle button, bottom-right
	drawDot(L.faceX + L.faceW * 0.78, row2Y + L.controlsH * 0.02, L.controlsH * 0.2, coralRed);
}

function statusLabel() {
	switch (appState) {
		case "LISTENING": return "LISTENING...";
		case "LOADING": return "THINKING...";
		case "SPEAKING": return "SPEAKING...";
		case "ERROR": return "OOPS, TRY AGAIN";
		default: return "";
	}
}

function draw() {
	const L = layout();
	render.begin();

	render.fillRectangle(bodyTeal, 0, 0, L.w, L.h);

	const faceRadius = L.faceW * 0.1;
	render.drawRoundRect(L.faceX - 2, L.faceY - 2, L.faceW + 4, L.faceH + 4, black, faceRadius + 2, 0b1111);
	render.drawRoundRect(L.faceX, L.faceY, L.faceW, L.faceH, faceMint, faceRadius, 0b1111);

	if (appState === "LOADING") {
		drawSpinner(L);
	} else if (appState === "ERROR") {
		drawErrorFace(L);
	} else {
		drawFace(L, appState === "TIME" && blinkClosed, appState === "SPEAKING" && talkOpen);
	}

	drawSpeaker(L);
	drawControls(L);

	if (appState === "TIME") {
		const now = new Date();
		let h = now.getHours();
		const ampm = h >= 12 ? "PM" : "AM";
		h = h % 12;
		if (h === 0) h = 12;
		const mm = String(now.getMinutes()).padStart(2, "0");
		const timeStr = `${h}:${mm} ${ampm}`;

		const tw = render.getTextWidth(timeStr, timeFont);
		render.drawText(timeStr, timeFont, timeWhite, L.w / 2 - tw / 2, L.timeY);

		const dateStr = `${DAYS[now.getDay()]} ${now.getMonth() + 1}/${now.getDate()}`;
		const dw = render.getTextWidth(dateStr, dateFont);
		const dateY = L.timeY + timeFont.height + 2;
		render.drawText(dateStr, dateFont, timeWhite, L.w / 2 - dw / 2, dateY);
	} else {
		const label = statusLabel();
		const lw = render.getTextWidth(label, statusFont);
		render.drawText(label, statusFont, timeWhite, L.w / 2 - lw / 2, L.timeY + 10);
	}

	render.drawText("BMO", wordFont, bmoCyan, 8, L.h - wordFont.height - 4);

	render.end();
}

function clearStateTimers() {
	if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; }
	if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
	if (talkTimer) { clearInterval(talkTimer); talkTimer = null; }
}

function goToTime() {
	clearStateTimers();
	appState = "TIME";
	draw();
}

function goToListening() {
	clearStateTimers();
	appState = "LISTENING";
	draw();
}

function goToLoading() {
	clearStateTimers();
	appState = "LOADING";
	draw();
	spinnerTimer = setInterval(() => {
		spinAngle = (spinAngle + 30) % 360;
		draw();
	}, 80);
}

function goToSpeaking(durationMs) {
	clearStateTimers();
	appState = "SPEAKING";
	draw();
	talkTimer = setInterval(() => {
		talkOpen = !talkOpen;
		draw();
	}, 180);
	stateTimer = setTimeout(goToTime, durationMs);
}

function goToError() {
	clearStateTimers();
	appState = "ERROR";
	draw();
	stateTimer = setTimeout(goToTime, 3000);
}

function scheduleBlink() {
	blinkTimer = setTimeout(() => {
		if (appState === "TIME") {
			blinkClosed = true;
			draw();
			setTimeout(() => {
				blinkClosed = false;
				if (appState === "TIME") draw();
				scheduleBlink();
			}, 140);
		} else {
			scheduleBlink();
		}
	}, 2600 + Math.random() * 2600);
}

watch.addEventListener("minutechange", () => {
	if (appState === "TIME") draw();
});
watch.addEventListener("resize", () => draw());

scheduleBlink();

// --- Voice request loop -----------------------------------------------

// The outbox's "writable" timing is unreliable early after launch (the
// watch<->phone session can still be negotiating), so rather than gate
// sends on onWritable, just retry write() until it stops throwing.
const SEND_RETRY_MS = 250;
const SEND_RETRY_LIMIT = 40; // ~10s of retrying

function sendPrompt(text, attempt) {
	attempt = attempt || 0;
	try {
		message.write(new Map([["PROMPT", text]]));
	} catch (e) {
		if (attempt < SEND_RETRY_LIMIT) {
			setTimeout(() => sendPrompt(text, attempt + 1), SEND_RETRY_MS);
		} else {
			goToError();
		}
	}
}

const message = new Message({
	keys: ["PROMPT", "DURATION", "ERR", "HELLO"],
	onReadable() {
		const msg = this.read();
		if (msg.has("DURATION")) {
			goToSpeaking(msg.get("DURATION"));
		} else if (msg.has("ERR")) {
			goToError();
		}
	},
});

const dictation = new Dictation({
	onReadable() {
		const text = dictation.read();
		if (text && text.length > 0) {
			goToLoading();
			sendPrompt(text);
		} else {
			// Dictation completed but produced no usable text — surface it
			// instead of silently dropping back to the clock.
			console.log("dictation onReadable: empty text");
			goToError();
		}
	},
	onError(status) {
		console.log("dictation onError: status=" + status);
		goToError();
	},
});
dictation.configure({ confirm: false, errorDialogs: false });

new Button({
	types: [TALK_BUTTON],
	onPush(down, type) {
		if (type !== TALK_BUTTON) return;
		if (down) {
			if (appState !== "TIME") return; // one request at a time
			goToListening();
			dictation.start();
		} else {
			if (appState === "LISTENING") {
				dictation.stop();
			}
		}
	},
});
