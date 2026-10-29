// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Sheet
// ========================

/// <summary>
/// The sheet of parchment every letter is written and read on.
///
/// <para>
/// NOTE: A letter must look the same on every screen: the same words on the same lines, the same gaps, the same handwriting.
/// So the sheet is always laid out at one fixed size (sheetWidth x sheetHeight design pixels) with one bundled font (Caveat),
/// and only then scaled as a whole to fit the screen. Lines are broken before scaling, so a 720p and a 4K screen wrap identically.
/// The writing box and the reading box share one class (.sheet-text) and both keep room for a scrollbar, so text wraps the same while it is written as when it is read.
/// </para>
///
/// </summary>
Owls.Sheet = (() =>
{
	const { Element } = Owls.Util;
	const T = Owls.Lang.T;

	/// <summary>
	/// The sheet's design size, matching the parchment texture's proportions (1607 x 1936). Must match .sheet in Immersive.css.
	/// </summary>
	const sheetWidth = 760;
	const sheetHeight = 916;

	/// <summary>
	/// Watches every slot a sheet sits in, so the sheet is scaled again whenever the space around it changes.
	/// </summary>
	const observer = new ResizeObserver((entries) =>
	{
		for (const entry of entries)
		{
			Fit(entry.target);
		}
	});

	/// <summary>
	/// Scale the sheet inside a slot to the largest size that fits it.
	/// </summary>
	/// <param name="slot">.sheet-slot element</param>
	function Fit(slot)
	{
		const frame = slot.querySelector(".sheet-frame");

		if (!frame || slot.clientWidth === 0 || slot.clientHeight === 0)
		{
			return;
		}

		const scale = Math.min(slot.clientWidth / sheetWidth, slot.clientHeight / sheetHeight);
		frame.style.setProperty("--sheet-scale", String(Math.max(0.1, scale)));
	}

	/// <summary>
	/// Create a sheet inside a slot that scales it to fit.
	/// </summary>
	/// <param name="content">Nodes laid out on the sheet, inside its writing area</param>
	/// <param name="extraClass">Extra class for the sheet (optional)</param>
	/// <returns>{ slot, sheet, area } where slot goes into the screen and area holds the content</returns>
	function Create(content, extraClass = "")
	{
		const area = Element("div", { className: "sheet-area" }, content);
		const sheet = Element("div", { className: `sheet ${extraClass}`.trim() }, [area]);
		const frame = Element("div", { className: "sheet-frame" }, [sheet]);
		const slot = Element("div", { className: "sheet-slot" }, [frame]);
		observer.observe(slot);
		requestAnimationFrame(() => Fit(slot));
		return { slot, sheet, area };
	}

	/// <summary>
	/// Create a sheet showing a letter to read.
	/// </summary>
	/// <param name="text">Letter text, exactly as stored</param>
	/// <returns>{ slot, sheet, area }</returns>
	function CreateReading(text)
	{
		return Create([Element("div", { className: "sheet-text is-reading", text })]);
	}

	/// <summary>
	/// Join names the way the player's language lists them ("Ominis and Natsai", "Ominis, Natsai and Poppy").
	/// </summary>
	/// <param name="names">Names in order</param>
	/// <returns>One phrase</returns>
	function JoinNames(names)
	{
		// Intl.ListFormat throws a RangeError for a locale it cannot parse; a plain comma list is the fallback.
		try
		{
			return new Intl.ListFormat(Owls.Lang.GetId(), { style: "long", type: "conjunction" }).format(names);
		}
		catch (error)
		{
			return names.join(", ");
		}
	}

	/// <summary>
	/// The greeting line of a letter: "Dear Ominis and Natsai,".
	/// </summary>
	/// <param name="names">Names of the recipients as the writer knows them</param>
	/// <returns>Greeting line</returns>
	function GetSalutation(names)
	{
		return T("mail.letter.salutation", { names: names.length > 0 ? JoinNames(names) : T("mail.letter.noName") });
	}

	/// <summary>
	/// The whole text of a letter written with the template: greeting, body, sign-off and signature, as the reader will see it.
	/// </summary>
	/// <param name="names">Names of the recipients as the writer knows them</param>
	/// <param name="body">What the writer wrote between greeting and sign-off</param>
	/// <param name="signature">Name signed at the bottom</param>
	/// <returns>Full letter text</returns>
	function Compose(names, body, signature)
	{
		return `${GetSalutation(names)}\n\n${body.replace(/^\n+|\s+$/g, "")}\n\n${T("mail.letter.closing")}\n${signature}`;
	}

	return { Create, CreateReading, GetSalutation, Compose, JoinNames, sheetWidth, sheetHeight };
})();
