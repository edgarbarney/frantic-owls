// FranticDreamer 2026
"use strict";

// ========================
// Constants
// ========================

const resourceName = "frantic-owls";

/// <summary>
/// The page of each front end. Only the one the server's mode names is ever loaded.
/// </summary>
const viewUrls = Object.freeze
({
	phone: "fw://resources/frantic-owls/UI/Index.html",
	immersive: "fw://resources/frantic-owls/UI/Immersive.html",
});

/// <summary>
/// Reference screen height the UI sizes are authored for. Larger screens scale up proportionally.
/// </summary>
const referenceHeight = 1080;

/// <summary>
/// Transparent border around the phone inside the view, in px at scale 1, so its shadow and slide animation are not clipped.
/// Must match --frame-pad in Phone.css.
/// </summary>
const framePadPx = 24;

/// <summary>
/// Longest the view is kept on screen for the close animation if the page never reports it finished.
/// </summary>
const closeFallbackMs = 800;

/// <summary>
/// Items queued for the page before it reported ready. Bounded so a page that never loads cannot grow it forever.
/// </summary>
const maxPendingItems = 512;

/// <summary>
/// How often a shown location's route is checked: put back if it went, and ended if the player has arrived.
/// </summary>
const locationCheckMs = 500;

/// <summary>
/// Layout used until the server sends its configuration.
/// </summary>
const defaultUi = Object.freeze({ scale: 1.0, widthPx: 360, heightPx: 700, rightMarginPx: 32, allowMove: false });

/// <summary>
/// Size of the strip at the top of the screen that immersive mode's notices drop into while the desk is closed, in px at scale 1.
/// Must fit .notice in Immersive.css with its shadow.
/// </summary>
const noticeWidthPx = 520;
const noticeHeightPx = 150;

// ========================
// State
// ========================

const input = Imports.get("hmp-lib").input;

/// <summary>
/// Texts this script shows itself (game notifications), by key, in the player's language once the server has sent it.
/// The English fallbacks cover the time before any language arrived, which is exactly when "not arrived yet" can be said.
/// </summary>
const clientStrings = new Map
([
	["client.noOwl", "Your owl has not arrived yet."],
	["client.openFailed", "The owl post could not be opened."],
]);

/// <summary>
/// Web view ID, or -1 while it does not exist.
/// </summary>
let view = -1;

/// <summary>
/// Front end the view was created for ("phone" or "immersive"), so a change of mode replaces it.
/// </summary>
let viewMode = "";

/// <summary>
/// True once the page has registered its listeners and said so.
/// </summary>
let isPageReady = false;

/// <summary>
/// True while the phone is open and focused.
/// </summary>
let isOpen = false;

/// <summary>
/// True while the player is moving or scaling the phone; the view then covers the whole screen.
/// </summary>
let isEditing = false;

/// <summary>
/// True while the page is showing something (a pop-up or the close animation) that needs the view on screen even though the phone is closed.
/// </summary>
let isOverlayActive = false;

/// <summary>
/// True from closing the phone until the page reports its overlay state, so the fallback timer knows whether it is still needed.
/// </summary>
let isClosePending = false;

/// <summary>
/// Fallback timer that hides the view if the close animation never reports back.
/// </summary>
let closeTimer = null;

/// <summary>
/// True once the server has sent this character's state, so opening the phone shows something meaningful.
/// </summary>
let hasState = false;

/// <summary>
/// hmp-lib control lease held while the phone is open.
/// </summary>
let controlLease = null;

/// <summary>
/// Disposer of the open-key shortcut, or null when none is bound.
/// </summary>
let unregisterShortcut = null;

/// <summary>
/// Last configuration received from the server.
/// </summary>
let clientConfig = null;

/// <summary>
/// The player's saved phone layout ({ x, y, scale }), or null for the default place.
/// </summary>
let savedLayout = null;

/// <summary>
/// Items waiting for the page to become ready.
/// </summary>
let pendingItems = [];

/// <summary>
/// The location the player is being routed to, or null when none: { key, label, chatId, messageId, target, isNative, arrivalCm, map }.
/// map is the minimap region a native marker was drawn in, so it is only drawn there.
/// </summary>
let shownLocation = null;

/// <summary>
/// Timers checking the shown location and ending it when its time runs out.
/// </summary>
let locationTimer = null;
let locationExpiryTimer = null;

/// <summary>
/// Counter for the requests this script sends on its own, whose replies nobody waits for.
/// </summary>
let ownRequestCounter = 0;

// ========================
// Helpers
// ========================

/// <summary>
/// Turn a network payload into an object, whether it arrived parsed or as JSON text.
/// </summary>
/// <param name="payload">Raw payload</param>
/// <returns>Parsed object, or an empty object when it is unusable</returns>
function ParsePayload(payload)
{
	if (typeof payload !== "string")
	{
		return payload && typeof payload === "object" ? payload : {};
	}

	// JSON.parse throws on malformed text; a payload we cannot read is simply ignored.
	try
	{
		const parsed = JSON.parse(payload);
		return parsed && typeof parsed === "object" ? parsed : {};
	}
	catch (error)
	{
		return {};
	}
}

/// <summary>
/// Work out where the phone goes and how big it is.
///
/// <para>
/// NOTE: Pages are rendered on the CPU, so the view normally covers only the phone plus a small border rather than the whole screen.
/// Input is unaffected either way: a focused view takes every click wherever it is.
/// Only while the player is moving the phone does the view cover the whole screen, so the phone can be dragged anywhere.
/// </para>
///
/// </summary>
/// <returns>{ view: { x, y, width, height }, screenWidth, screenHeight, baseScale, multiplier, centreX, centreY }</returns>
function GetGeometry()
{
	const ui = clientConfig && clientConfig.ui ? clientConfig.ui : defaultUi;
	const screen = Web.getScreenSize() || { width: 1920, height: 1080 };
	const screenWidth = Math.max(640, Number(screen.width) || 1920);
	const screenHeight = Math.max(480, Number(screen.height) || 1080);

	if (IsImmersive())
	{
		return GetImmersiveGeometry(ui, screenWidth, screenHeight);
	}
	const baseScale = ui.scale * (screenHeight / referenceHeight);
	const layout = ui.allowMove ? savedLayout : null;
	const multiplier = layout ? layout.scale : 1;
	const scale = baseScale * multiplier;
	const phoneWidth = ui.widthPx * scale;
	const phoneHeight = ui.heightPx * scale;
	const pad = framePadPx * scale;

	let centreX = layout ? layout.x * screenWidth : screenWidth - ui.rightMarginPx * baseScale - phoneWidth / 2;
	let centreY = layout ? layout.y * screenHeight : screenHeight / 2;

	// Keep the whole phone on screen, whatever resolution the layout was saved at.
	centreX = Math.min(screenWidth - phoneWidth / 2, Math.max(phoneWidth / 2, centreX));
	centreY = Math.min(screenHeight - phoneHeight / 2, Math.max(phoneHeight / 2, centreY));

	const docked =
	{
		x: Math.round(centreX - phoneWidth / 2 - pad),
		y: Math.round(centreY - phoneHeight / 2 - pad),
		width: Math.ceil(phoneWidth + pad * 2),
		height: Math.ceil(phoneHeight + pad * 2),
	};

	return {
		view: isEditing ? { x: 0, y: 0, width: screenWidth, height: screenHeight } : docked,
		screenWidth,
		screenHeight,
		baseScale,
		multiplier,
		centreX: centreX / screenWidth,
		centreY: centreY / screenHeight,
	};
}

/// <summary>
/// Work out where immersive mode's view goes.
///
/// <para>
/// NOTE: The letter desk covers the whole screen while it is open (and while it plays its closing animation), dimming the game behind it.
/// Closed, the view shrinks to a strip at the top of the screen, just big enough for a notice that an owl has arrived: pages render on the CPU, so a closed desk should not cost a full screen.
/// </para>
///
/// </summary>
/// <param name="ui">The "ui" part of the client configuration (immersivemode_ui)</param>
/// <param name="screenWidth">Screen width in pixels</param>
/// <param name="screenHeight">Screen height in pixels</param>
/// <returns>{ view: { x, y, width, height }, mode, baseScale }</returns>
function GetImmersiveGeometry(ui, screenWidth, screenHeight)
{
	const baseScale = (Number(ui.scale) || 1) * (screenHeight / referenceHeight);

	if (isOpen || isClosePending)
	{
		return { view: { x: 0, y: 0, width: screenWidth, height: screenHeight }, mode: "desk", baseScale };
	}

	const width = Math.min(screenWidth, Math.ceil(noticeWidthPx * baseScale));
	const height = Math.ceil(noticeHeightPx * baseScale);
	return { view: { x: Math.round((screenWidth - width) / 2), y: 0, width, height }, mode: "notice", baseScale };
}

/// <summary>
/// Whether the server runs immersive mode's letter desk rather than the phone.
/// </summary>
/// <returns>True for immersive mode</returns>
function IsImmersive()
{
	return !!clientConfig && clientConfig.mode === "immersive";
}

/// <summary>
/// Move and size the view for the current mode, and tell the page how to lay itself out.
/// </summary>
function ApplyGeometry()
{
	if (view < 0)
	{
		return;
	}

	const geometry = GetGeometry();
	Web.resizeView(view, geometry.view.width, geometry.view.height);
	Web.setViewPosition(view, geometry.view.x, geometry.view.y);

	if (isPageReady && IsImmersive())
	{
		Web.emit(view, "frantic-owls:layout", { mode: geometry.mode, baseScale: geometry.baseScale });
		return;
	}

	if (isPageReady)
	{
		Web.emit(view, "frantic-owls:layout",
		{
			mode: isEditing ? "edit" : "docked",
			baseScale: geometry.baseScale,
			multiplier: geometry.multiplier,
			centreX: geometry.centreX,
			centreY: geometry.centreY,
		});
	}
}

/// <summary>
/// Create the view if it does not exist yet and hook up the page's events.
/// </summary>
/// <returns>True if a view exists afterwards</returns>
function EnsureView()
{
	// The front end is only known once the server's configuration has arrived; items wait in pendingItems until then.
	if (!clientConfig)
	{
		return false;
	}

	const mode = IsImmersive() ? "immersive" : "phone";

	// A server that switched mode (and restarted the resource) gets the other page, which is only loaded now.
	if (view >= 0 && viewMode !== mode)
	{
		Web.destroyView(view);
		view = -1;
		isPageReady = false;
	}

	if (view >= 0)
	{
		return true;
	}

	const geometry = GetGeometry();

	// createView throws when the browser cannot be created; there is nothing to retry until the next open.
	try
	{
		view = Web.createView(viewUrls[mode], { x: geometry.view.x, y: geometry.view.y, width: geometry.view.width, height: geometry.view.height, zIndex: 150, visible: false, focus: false });
	}
	catch (error)
	{
		console.error(`Client: Could not create the ${mode} view: ${error}`);
		view = -1;
		return false;
	}

	viewMode = mode;

	Web.on(view, "frantic-owls:ready", () =>
	{
		isPageReady = true;
		ApplyGeometry();

		const items = pendingItems;
		pendingItems = [];
		ForwardItems(items);

		if (isOpen)
		{
			Web.emit(view, "frantic-owls:opened", {});
		}
	});

	Web.on(view, "frantic-owls:request", (request) =>
	{
		Events.emitServer("frantic-owls:request", JSON.stringify(request || {}));
	});

	Web.on(view, "frantic-owls:close", () => Close());

	Web.on(view, "frantic-owls:overlay", (payload) =>
	{
		const wasClosing = isClosePending;
		isClosePending = false;
		isOverlayActive = !!(payload && payload.active);

		// The letter desk's closing animation is over, so its view shrinks back to the notice strip.
		if (wasClosing && IsImmersive())
		{
			ApplyGeometry();
		}

		UpdateVisibility();
	});

	Web.on(view, "frantic-owls:sound", () => PlayWwiseSound());

	// Floo-Call voice goes straight through: it must not wait in pendingItems, and a message the server will not want is its business.
	Web.on(view, "frantic-owls:voice", (message) =>
	{
		if (typeof message === "string")
		{
			Events.emitServer("frantic-owls:voice", message);
		}
	});
	Web.on(view, "frantic-owls:layout-edit", () => SetEditing(true));
	Web.on(view, "frantic-owls:layout-cancel", () => SetEditing(false));

	Web.on(view, "frantic-owls:layout-done", (payload) =>
	{
		savedLayout = payload && payload.layout ? payload.layout : null;
		SetEditing(false);
	});

	return true;
}

/// <summary>
/// Enter or leave the mode where the player drags and scales the phone.
/// </summary>
/// <param name="editing">True to start editing</param>
function SetEditing(editing)
{
	const ui = clientConfig && clientConfig.ui ? clientConfig.ui : defaultUi;

	if (editing && (!isOpen || !ui.allowMove))
	{
		return;
	}

	isEditing = editing;
	ApplyGeometry();
}

/// <summary>
/// Show the view while it has something to draw (phone open, a pop-up or the close animation), hide it otherwise.
/// </summary>
function UpdateVisibility()
{
	if (view < 0)
	{
		return;
	}

	if (isOpen || isOverlayActive)
	{
		Web.showView(view);
	}
	else
	{
		Web.hideView(view);
	}
}

/// <summary>
/// Hand items to the page, or queue them until it is ready.
/// </summary>
/// <param name="items">Outbox items ({ type, data })</param>
function ForwardItems(items)
{
	if (items.length === 0)
	{
		return;
	}

	if (view < 0 || !isPageReady)
	{
		pendingItems.push(...items);

		if (pendingItems.length > maxPendingItems)
		{
			pendingItems = pendingItems.slice(pendingItems.length - maxPendingItems);
		}

		return;
	}

	Web.emit(view, "frantic-owls:items", { items });
}

/// <summary>
/// Play the configured Wwise notification event, for servers using soundMode "wwise".
/// </summary>
function PlayWwiseSound()
{
	if (!clientConfig || clientConfig.soundMode !== "wwise" || !clientConfig.wwiseEvent)
	{
		return;
	}

	Audio.playSound(clientConfig.wwiseEvent);
}

/// <summary>
/// Bind (or unbind) the optional key that opens the phone, as configured on the server.
/// </summary>
function UpdateShortcut()
{
	if (unregisterShortcut)
	{
		unregisterShortcut();
		unregisterShortcut = null;
	}

	const key = clientConfig ? clientConfig.openKey : "";

	if (!key)
	{
		return;
	}

	// An unknown key name throws inside the binding; a bad config value should not stop the resource.
	try
	{
		unregisterShortcut = input.shortcuts.register({ resource: resourceName, id: "open-phone", key, state: "down", priority: 10, when: () => hasState && !isOpen, handler: () => Open() });
	}
	catch (error)
	{
		console.error(`Client: Could not bind the open key "${key}": ${error}`);
		unregisterShortcut = null;
	}
}

// ========================
// Open & Close
// ========================

/// <summary>
/// Open the phone and give it input focus.
/// </summary>
function Open()
{
	if (!hasState)
	{
		Game.notify(clientStrings.get("client.noOwl"));
		return;
	}

	if (!EnsureView())
	{
		Game.notify(clientStrings.get("client.openFailed"));
		return;
	}

	clearTimeout(closeTimer);
	closeTimer = null;
	isClosePending = false;
	isOpen = true;
	isEditing = false;
	ApplyGeometry();
	UpdateVisibility();
	Web.focusView(view, true);

	if (!controlLease)
	{
		controlLease = input.controls.acquire({ resource: resourceName, id: "phone" });
	}

	if (isPageReady)
	{
		Web.emit(view, "frantic-owls:opened", {});
	}
}

/// <summary>
/// Close the phone and hand input back to the game straight away.
/// The view stays on screen while the page plays its close animation, then the page releases it.
/// </summary>
function Close()
{
	if (!isOpen)
	{
		return;
	}

	isOpen = false;

	if (isEditing)
	{
		isEditing = false;
		ApplyGeometry();
	}

	if (view >= 0)
	{
		Web.focusView(view, false);

		if (isPageReady)
		{
			isOverlayActive = true;
			isClosePending = true;
			Web.emit(view, "frantic-owls:closed", {});

			closeTimer = setTimeout(() =>
			{
				closeTimer = null;

				if (isClosePending)
				{
					isClosePending = false;
					isOverlayActive = false;
					ApplyGeometry();
					UpdateVisibility();
				}
			}, closeFallbackMs);
		}
	}

	if (controlLease)
	{
		controlLease.release();
		controlLease = null;
	}

	UpdateVisibility();
}

// ========================
// Server Events
// ========================

// ========================
// Shown Locations
// ========================

/// <summary>
/// The minimap region the game is drawing (e.g. "overland", "hogwarts"), or "" when this client cannot tell.
/// </summary>
/// <returns>Region name, "none" behind a load screen</returns>
function GetMinimapMap()
{
	const state = typeof Minimap !== "undefined" ? Minimap.state() : null;
	return state && typeof state.map === "string" ? state.map : "";
}

/// <summary>
/// Take down the location route and native marker this script set, leaving routes other resources set alone.
/// </summary>
function ClearLocation()
{
	clearInterval(locationTimer);
	clearTimeout(locationExpiryTimer);
	locationTimer = null;
	locationExpiryTimer = null;

	const location = shownLocation;
	shownLocation = null;

	if (!location || typeof Blips === "undefined")
	{
		return;
	}

	if (Blips.route() === location.key)
	{
		Blips.clearRoute();
	}

	if (location.isNative)
	{
		Blips.remove(location.key);
	}
}

/// <summary>
/// Take the shown location down here at once and ask the server to do the same, so its marker and the page follow.
/// </summary>
/// <param name="reason">"arrived" or "expired"</param>
function EndLocation(reason)
{
	const location = shownLocation;

	if (!location)
	{
		return;
	}

	ClearLocation();
	ownRequestCounter++;

	// The page's requests are numbered "r1", "r2", ...; a different prefix keeps this reply from settling one of them.
	Events.emitServer("frantic-owls:request", JSON.stringify({ requestId: `c${ownRequestCounter}`, action: "locations.hide", data: { chatId: location.chatId, messageId: location.messageId, reason } }));
}

/// <summary>
/// Keep the shown location's route alive, and end it once the player stands at the place.
///
/// <para>
/// NOTE: hmp-blips replays its markers on every area or region change (e.g. walking through a door) by removing every native blip, which ends the route too.
/// It puts our marker back once the player is in its area again, but not the route, so the route is set again here whenever it has gone.
/// </para>
///
/// <para>
/// NOTE: Arrival is only checked while our route is drawn, because only then is the marker on this map: coordinates from another area (e.g. an interior) mean a different place.
/// </para>
///
/// </summary>
function CheckLocation()
{
	const location = shownLocation;

	if (!location || typeof Blips === "undefined")
	{
		return;
	}

	if (location.isNative)
	{
		const map = GetMinimapMap();

		// A native marker only means something on the map it was drawn on; elsewhere it is hidden until the player is back.
		if (location.map && map !== location.map)
		{
			if (location.isDrawn)
			{
				if (Blips.route() === location.key)
				{
					Blips.clearRoute();
				}

				Blips.remove(location.key);
				location.isDrawn = false;
			}

			return;
		}

		// Setting the same key again only moves the marker, so drawing it whenever the route is gone also covers a load screen wiping it.
		if (!location.isDrawn || (Blips.route() ?? null) === null)
		{
			location.isDrawn = Blips.setMarker(location.key, location.target.x, location.target.y, location.target.z, undefined, location.label) !== false;
		}
	}

	// Another resource's route is left alone; ours comes back once theirs ends.
	if ((Blips.route() ?? null) === null)
	{
		Blips.setRoute(location.key, location.label);
	}

	if (Blips.route() !== location.key || typeof LocalPlayer === "undefined")
	{
		return;
	}

	const position = LocalPlayer.getPosition();

	if (!position)
	{
		return;
	}

	const dx = Number(position.x) - location.target.x;
	const dy = Number(position.y) - location.target.y;
	const dz = Number(position.z) - location.target.z;

	if (dx * dx + dy * dy + dz * dz <= location.arrivalCm * location.arrivalCm)
	{
		EndLocation("arrived");
	}
}

/// <summary>
/// Route the player to a location owl the server put on their map, until they reach it or it is taken down.
/// </summary>
/// <param name="data">{ key, label, chatId, messageId, target, isNative, seconds, arrivalMetres } where target is { x, y, z } in centimetres and seconds is 0 for no time limit</param>
function ShowLocation(data)
{
	const target = data.target || {};
	const point = { x: Number(target.x), y: Number(target.y), z: Number(target.z) };

	if (typeof Blips === "undefined" || typeof data.key !== "string" || !data.key || ![point.x, point.y, point.z].every(Number.isFinite))
	{
		return;
	}

	ClearLocation();

	const map = GetMinimapMap();

	shownLocation =
	{
		key: data.key,
		label: String(data.label || ""),
		chatId: Number(data.chatId) || 0,
		messageId: Number(data.messageId) || 0,
		target: point,
		isNative: data.isNative === true,
		isDrawn: false,
		arrivalCm: Math.max(1, Number(data.arrivalMetres) || 10) * 100,
		map: map !== "none" ? map : "",
	};

	const seconds = Number(data.seconds) || 0;

	if (seconds > 0)
	{
		locationExpiryTimer = setTimeout(() => EndLocation("expired"), seconds * 1000);
	}

	// An hmp-blips marker reaches this client on its own message, which may land after ours; the check sets the route once it is there.
	locationTimer = setInterval(CheckLocation, locationCheckMs);
	CheckLocation();
}

/// <summary>
/// Take down the shown location the server says is over, unless a newer one has replaced it here already.
/// </summary>
/// <param name="data">{ chatId, messageId, reason }</param>
function OnLocationCleared(data)
{
	if (shownLocation && shownLocation.chatId === Number(data.chatId) && shownLocation.messageId === Number(data.messageId))
	{
		ClearLocation();
	}
}

/// <summary>
/// React to the few item types the client script itself cares about, then pass everything on to the page.
/// </summary>
/// <param name="payload">{ items: [{ type, data }] }</param>
function OnBatch(payload)
{
	const batch = ParsePayload(payload);
	const items = Array.isArray(batch.items) ? batch.items : [];
	let needsOverlay = false;
	let isLayoutChanged = false;

	for (const item of items)
	{
		if (!item || typeof item.type !== "string")
		{
			continue;
		}

		const data = item.data || {};

		switch (item.type)
		{
		case "state:reset":
			clientConfig = data.config || clientConfig;
			savedLayout = data.settings ? data.settings.layout || null : null;
			hasState = true;
			isLayoutChanged = true;
			UpdateShortcut();
			break;
		case "settings:update":
			savedLayout = data.settings ? data.settings.layout || null : null;
			isLayoutChanged = true;
			break;
		case "state:clear":
			hasState = false;
			ClearLocation();
			Close();
			break;
		case "ui:open":
			Open();
			break;
		case "location:route":
			ShowLocation(data);
			break;
		case "location:clear":
			OnLocationCleared(data);
			// Arriving is announced with a pop-up, which a closed phone needs its view on screen for.
			needsOverlay = needsOverlay || data.reason === "arrived";
			break;
		case "lang:chunk":
			for (const pair of Array.isArray(data.strings) ? data.strings : [])
			{
				if (Array.isArray(pair) && clientStrings.has(pair[0]) && typeof pair[1] === "string")
				{
					clientStrings.set(pair[0], pair[1]);
				}
			}
			break;
		case "message:new":
		case "mail:arrived":
		case "notify":
		case "inform:request":
		case "call:incoming":
		case "call:logged":
			needsOverlay = true;
			break;
		default:
			break;
		}
	}

	if (isLayoutChanged && !isEditing)
	{
		ApplyGeometry();
	}

	// A closed phone has its view hidden; put it on screen before the page draws the pop-up, which turns it off again when done.
	if (needsOverlay && !isOpen && EnsureView())
	{
		isOverlayActive = true;
		UpdateVisibility();
	}

	EnsureView();

	// The letter desk needs to know which owl post (if any) it was opened at, so immersive pages get "ui:open" too.
	ForwardItems(items.filter((item) => item && (item.type !== "ui:open" || IsImmersive())));
}

Events.on("frantic-owls:batch", OnBatch);

// The other owl's voice during a Floo-Call. Late voice is worthless, so it is dropped rather than queued while the page is not ready.
Events.on("frantic-owls:voice", (message) =>
{
	if (view >= 0 && isPageReady && typeof message === "string")
	{
		Web.emit(view, "frantic-owls:voice", message);
	}
});

Events.on("resourceStop", (name) =>
{
	if (name === resourceName)
	{
		ClearLocation();
		Close();
	}
});

Events.emitServer("frantic-owls:hello", "{}");
