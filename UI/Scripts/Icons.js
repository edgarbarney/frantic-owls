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
		fingerprint: Fa("fingerprint"),
		// A blob of sealing wax, its rim run out unevenly, pressed with the owl. The two halves crack apart when the seal is broken.
		waxSeal: "<svg viewBox=\"0 0 100 100\" class=\"wax-seal-art\"><defs><radialGradient id=\"wax-red\" cx=\"38%\" cy=\"32%\" r=\"75%\"><stop offset=\"0\" stop-color=\"#c8352c\"/><stop offset=\"0.55\" stop-color=\"#8e1b16\"/><stop offset=\"1\" stop-color=\"#5a0d0a\"/></radialGradient></defs><path fill=\"url(#wax-red)\" d=\"M50 3c7 0 9 4 15 5s11-1 15 4 2 9 6 14 9 7 8 14-6 8-6 15 5 11 1 17-10 5-14 10-4 11-11 12-10-3-14-3-9 5-15 3-8-8-13-11-12-4-14-10 3-10 1-16-7-9-6-15 6-8 8-14-1-11 4-15 10-1 15-4 7-6 15-6z\"/><circle cx=\"50\" cy=\"50\" r=\"29\" fill=\"none\" stroke=\"#4a0806\" stroke-opacity=\"0.55\" stroke-width=\"2.5\"/><circle cx=\"50\" cy=\"50\" r=\"25\" fill=\"none\" stroke=\"#f08a7a\" stroke-opacity=\"0.25\" stroke-width=\"1\"/><g transform=\"translate(32 30) scale(1.5)\" fill=\"none\" stroke=\"#4a0806\" stroke-opacity=\"0.8\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 4l2.5 3h7L18 4v9a6 6 0 0 1-12 0z\"/><circle cx=\"9.5\" cy=\"10.5\" r=\"2\"/><circle cx=\"14.5\" cy=\"10.5\" r=\"2\"/><path d=\"M11.2 13.6L12 15l.8-1.4\"/></g></svg>",
		forward: Fa("share"),
		poll: Fa("square-poll-vertical"),
		coins: Fa("coins"),
		dial: Fa("hashtag"),
		radio: Fa("circle", "regular"),
		radioOn: Fa("circle-check"),
		box: Fa("square", "regular"),
		boxOn: Fa("square-check"),
	});
})();
