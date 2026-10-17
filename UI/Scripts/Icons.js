// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Icons
// ========================

/// <summary>
/// Icon markup. Everything except the owl comes from Font Awesome Free (loaded from cdnjs in Index.html);
/// Font Awesome's owl is a Pro icon, so the owl stays an inline SVG drawn with currentColor.
/// These strings are static and authored here; they are the only markup ever assigned with innerHTML.
/// </summary>
Owls.Icons = (() =>
{
	/// <summary>
	/// Markup of one Font Awesome icon.
	/// </summary>
	/// <param name="name">Icon name without the "fa-" prefix</param>
	/// <param name="style">"solid" or "regular"</param>
	/// <returns>Icon element markup</returns>
	function Fa(name, style = "solid")
	{
		return `<i class="fa-${style} fa-${name}" aria-hidden="true"></i>`;
	}

	return Object.freeze
	({
		owl: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 4l2.5 3h7L18 4v9a6 6 0 0 1-12 0z\"/><circle cx=\"9.5\" cy=\"10.5\" r=\"2\"/><circle cx=\"14.5\" cy=\"10.5\" r=\"2\"/><path d=\"M11.2 13.6L12 15l.8-1.4\"/><path d=\"M9 19.5l-1 2M15 19.5l1 2\"/></svg>",
		contacts: Fa("address-book"),
		inform: Fa("scroll"),
		settings: Fa("gear"),
		search: Fa("magnifying-glass"),
		back: Fa("chevron-left"),
		close: Fa("xmark"),
		send: Fa("paper-plane"),
		quill: Fa("feather-pointed"),
		check: Fa("check"),
		group: Fa("users"),
		person: Fa("user"),
		move: Fa("up-down-left-right"),
		resize: Fa("up-right-and-down-left-from-center"),
		minus: Fa("minus"),
		plus: Fa("plus"),
		reset: Fa("rotate-left"),
		image: Fa("image"),
		palette: Fa("palette"),
		leave: Fa("right-from-bracket"),
		official: Fa("landmark"),
		bell: Fa("bell"),
		bellSlash: Fa("bell-slash"),
		ban: Fa("ban"),
		location: Fa("location-dot"),
		map: Fa("map-location-dot"),
		smile: Fa("face-smile", "regular"),
		star: Fa("star"),
		starOutline: Fa("star", "regular"),
		thumbtack: Fa("thumbtack"),
		reply: Fa("reply"),
		trash: Fa("trash-can"),
		unsend: Fa("rotate-left"),
		checkDouble: Fa("check-double"),
		info: Fa("circle-info"),
		crown: Fa("crown"),
		userPlus: Fa("user-plus"),
		pen: Fa("pen"),
		moon: Fa("moon"),
		language: Fa("language"),
		chevronDown: Fa("chevron-down"),
		chevronRight: Fa("chevron-right"),
		droplet: Fa("droplet"),
		shield: Fa("shield-halved"),
		flame: Fa("fire-flame-curved"),
		snowflake: Fa("snowflake"),
		microphone: Fa("microphone"),
		microphoneSlash: Fa("microphone-slash"),
		callIn: Fa("arrow-down"),
		callOut: Fa("arrow-up"),
	});
})();
