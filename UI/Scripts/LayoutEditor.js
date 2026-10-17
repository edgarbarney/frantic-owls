// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Layout Editor
// ========================

/// <summary>
/// Lets the player drag the phone anywhere on screen and scale it, when the server allows it (ui.allowMove).
///
/// <para>
/// NOTE: Normally the view is only as big as the phone, so the phone cannot be dragged past its own edges.
/// Editing therefore asks the client script for a full-screen view first; the client answers with a "layout" event in "edit" mode,
/// and this module then places the phone at absolute pixel coordinates. On Done the layout is saved on the server
/// (as the phone's centre in screen fractions plus a scale) and the client shrinks the view back around the phone's new place.
/// </para>
///
/// </summary>
Owls.LayoutEditor = (() =>
{
	const baseFontPx = 16;
	const minScale = 0.6;
	const maxScale = 1.6;
	const scaleStep = 0.05;

	const editor = document.getElementById("layout-editor");
	const phone = document.getElementById("phone");
	const dragSurface = document.getElementById("phone-drag");
	const resizeHandle = document.getElementById("phone-resize");
	const scaleLabel = document.getElementById("layout-scale");
	const hint = editor.querySelector(".layout-hint");

	/// <summary>
	/// Last layout from the client: { mode, baseScale, multiplier, centreX, centreY }.
	/// </summary>
	let layout = { mode: "docked", baseScale: 1, multiplier: 1, centreX: 0.8, centreY: 0.5 };

	/// <summary>
	/// Pointer drag in progress: { kind: "move" | "resize", pointerId, startX, startY, centreX, centreY, multiplier, distance }.
	/// </summary>
	let drag = null;

	let isSaving = false;

	/// <summary>
	/// Size the whole page from the scale, since every size in the stylesheet is in rem.
	/// </summary>
	function ApplyFontSize()
	{
		document.documentElement.style.fontSize = `${baseFontPx * layout.baseScale * layout.multiplier}px`;
	}

	/// <summary>
	/// Put the phone at the current centre, nudged back inside the screen if it would stick out.
	/// </summary>
	function PlacePhone()
	{
		const width = phone.offsetWidth;
		const height = phone.offsetHeight;
		const centreX = Math.min(window.innerWidth - width / 2, Math.max(width / 2, layout.centreX * window.innerWidth));
		const centreY = Math.min(window.innerHeight - height / 2, Math.max(height / 2, layout.centreY * window.innerHeight));

		layout.centreX = centreX / window.innerWidth;
		layout.centreY = centreY / window.innerHeight;
		phone.style.left = `${centreX - width / 2}px`;
		phone.style.top = `${centreY - height / 2}px`;
		scaleLabel.textContent = `${Math.round(layout.multiplier * 100)}%`;
	}

	/// <summary>
	/// Change the scale, keeping the phone's centre where it is.
	/// </summary>
	/// <param name="multiplier">New scale multiplier, clamped to (0.6 - 1.6)</param>
	function SetScale(multiplier)
	{
		layout.multiplier = Math.min(maxScale, Math.max(minScale, Math.round(multiplier * 100) / 100));
		ApplyFontSize();
		PlacePhone();
	}

	/// <summary>
	/// Save a layout on the server, then hand the result to the client so it re-docks the view there.
	/// </summary>
	/// <param name="value">{ x, y, scale }, or null for the default place</param>
	async function Commit(value)
	{
		if (isSaving)
		{
			return;
		}

		isSaving = true;
		hint.textContent = Owls.Lang.T("layout.saving");

		const result = await Owls.Bridge.Request("settings.update", { settings: { layout: value } });

		isSaving = false;
		hint.textContent = Owls.Lang.T("layout.hint");

		if (!result.ok)
		{
			hint.textContent = result.error;
			return;
		}

		Owls.Store.SetSettings(result.data.settings);
		Owls.Bridge.Send("frantic-owls:layout-done", { layout: result.data.settings.layout });
	}

	/// <summary>
	/// Start a move or resize drag.
	/// </summary>
	/// <param name="event">Pointer event</param>
	/// <param name="kind">"move" or "resize"</param>
	function BeginDrag(event, kind)
	{
		if (event.button !== 0)
		{
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const rect = phone.getBoundingClientRect();
		const centreX = rect.left + rect.width / 2;
		const centreY = rect.top + rect.height / 2;

		drag =
		{
			kind,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			centreX: layout.centreX,
			centreY: layout.centreY,
			multiplier: layout.multiplier,
			distance: Math.max(1, Math.hypot(event.clientX - centreX, event.clientY - centreY)),
			pixelCentreX: centreX,
			pixelCentreY: centreY,
		};

		event.currentTarget.setPointerCapture(event.pointerId);
	}

	/// <summary>
	/// Follow the pointer during a drag.
	/// </summary>
	/// <param name="event">Pointer event</param>
	function UpdateDrag(event)
	{
		if (!drag || event.pointerId !== drag.pointerId)
		{
			return;
		}

		if (drag.kind === "move")
		{
			layout.centreX = drag.centreX + (event.clientX - drag.startX) / window.innerWidth;
			layout.centreY = drag.centreY + (event.clientY - drag.startY) / window.innerHeight;
			PlacePhone();
			return;
		}

		// Resizing scales with the pointer's distance from the phone's centre, so the corner follows the cursor.
		const distance = Math.hypot(event.clientX - drag.pixelCentreX, event.clientY - drag.pixelCentreY);
		SetScale(drag.multiplier * (distance / drag.distance));
	}

	/// <summary>
	/// Finish a drag.
	/// </summary>
	/// <param name="event">Pointer event</param>
	function EndDrag(event)
	{
		if (drag && event.pointerId === drag.pointerId)
		{
			drag = null;
		}
	}

	dragSurface.addEventListener("pointerdown", (event) => BeginDrag(event, "move"));
	resizeHandle.addEventListener("pointerdown", (event) => BeginDrag(event, "resize"));

	for (const target of [dragSurface, resizeHandle])
	{
		target.addEventListener("pointermove", UpdateDrag);
		target.addEventListener("pointerup", EndDrag);
		target.addEventListener("pointercancel", EndDrag);
	}

	dragSurface.addEventListener("wheel", (event) =>
	{
		event.preventDefault();
		SetScale(layout.multiplier + (event.deltaY < 0 ? scaleStep : -scaleStep));
	}, { passive: false });

	document.getElementById("layout-smaller").innerHTML = Owls.Icons.minus;
	document.getElementById("layout-larger").innerHTML = Owls.Icons.plus;
	document.getElementById("layout-smaller").addEventListener("click", () => SetScale(layout.multiplier - scaleStep));
	document.getElementById("layout-larger").addEventListener("click", () => SetScale(layout.multiplier + scaleStep));
	document.getElementById("layout-done").addEventListener("click", () => Commit({ x: layout.centreX, y: layout.centreY, scale: layout.multiplier }));
	document.getElementById("layout-reset").addEventListener("click", () => Commit(null));
	document.getElementById("layout-cancel").addEventListener("click", Cancel);

	/// <summary>
	/// Ask the client script for the full-screen view needed to start editing.
	/// </summary>
	function Request()
	{
		Owls.Bridge.Send("frantic-owls:layout-edit", null);
	}

	/// <summary>
	/// Leave editing without saving; the client re-docks the view at the saved place.
	/// </summary>
	function Cancel()
	{
		drag = null;
		Owls.Bridge.Send("frantic-owls:layout-cancel", null);
	}

	/// <summary>
	/// Apply a layout from the client script, entering or leaving edit mode as it says.
	/// </summary>
	/// <param name="data">{ mode, baseScale, multiplier, centreX, centreY }</param>
	function Apply(data)
	{
		layout =
		{
			mode: data.mode === "edit" ? "edit" : "docked",
			baseScale: Number(data.baseScale) > 0 ? Number(data.baseScale) : 1,
			multiplier: Number(data.multiplier) > 0 ? Number(data.multiplier) : 1,
			centreX: Number.isFinite(Number(data.centreX)) ? Number(data.centreX) : 0.8,
			centreY: Number.isFinite(Number(data.centreY)) ? Number(data.centreY) : 0.5,
		};

		const isEditing = layout.mode === "edit";

		ApplyFontSize();
		document.body.classList.toggle("is-editing", isEditing);
		editor.hidden = !isEditing;
		dragSurface.hidden = !isEditing;
		hint.textContent = Owls.Lang.T("layout.hint");

		if (isEditing)
		{
			PlacePhone();
		}
		else
		{
			drag = null;
			phone.style.left = "";
			phone.style.top = "";
		}
	}

	/// <summary>
	/// Whether the phone is being moved right now.
	/// </summary>
	/// <returns>True while editing</returns>
	function IsEditing()
	{
		return layout.mode === "edit";
	}

	return { Request, Cancel, Apply, IsEditing };
})();
