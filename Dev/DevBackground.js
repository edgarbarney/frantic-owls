// FranticDreamer 2026
"use strict";

// ========================
// Development Background
// ========================

/// <summary>
/// Lets the browser previews (Dev/Preview.html and Dev/ImmersivePreview.html) show any picture behind the page, such as a screenshot of the game,
/// so translucent parts of the UI can be judged against something like the real world.
///
/// <para>
/// NOTE: The picture is chosen from the computer and never leaves the browser.
/// It is shrunk to at most maxSide pixels and kept in localStorage, so it survives the many reloads of working on the UI; a picture too big even then lasts until the page is reloaded.
/// </para>
///
/// </summary>
window.OwlsDevBackground = (() =>
{
	const storageKey = "frantic-owls:dev-background";
	const maxSide = 1920;
	const quality = 0.85;

	const style = document.createElement("style");
	style.textContent = "body.has-dev-background { background: #000 var(--dev-background) center / cover no-repeat fixed !important; }";
	document.head.appendChild(style);

	/// <summary>
	/// Show a picture behind the page.
	/// </summary>
	/// <param name="url">Image URL (a data URL from Pick, or a stored one)</param>
	function Apply(url)
	{
		document.body.style.setProperty("--dev-background", `url("${url}")`);
		document.body.classList.add("has-dev-background");
	}

	/// <summary>
	/// Shrink a picked image so it fits localStorage, as a JPEG data URL.
	/// </summary>
	/// <param name="file">Picked image file</param>
	/// <returns>Promise of the data URL, or "" when the browser cannot read the image</returns>
	function Shrink(file)
	{
		return new Promise((resolve) =>
		{
			const source = URL.createObjectURL(file);
			const image = new Image();

			image.onload = () =>
			{
				const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
				const canvas = document.createElement("canvas");
				canvas.width = Math.round(image.naturalWidth * ratio);
				canvas.height = Math.round(image.naturalHeight * ratio);
				canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
				URL.revokeObjectURL(source);
				resolve(canvas.toDataURL("image/jpeg", quality));
			};

			image.onerror = () =>
			{
				URL.revokeObjectURL(source);
				resolve("");
			};

			image.src = source;
		});
	}

	/// <summary>
	/// Ask for a picture on this computer and show it behind the page.
	/// </summary>
	function Pick()
	{
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";

		input.addEventListener("change", async () =>
		{
			const file = input.files && input.files[0];

			if (!file)
			{
				return;
			}

			const url = await Shrink(file);

			if (!url)
			{
				console.warn("DevBackground: that file could not be read as an image.");
				return;
			}

			Apply(url);

			// localStorage throws when it is full or unavailable; the picture then only lasts until the page reloads.
			try
			{
				window.localStorage.setItem(storageKey, url);
			}
			catch (error)
			{
				console.warn("DevBackground: the picture is too big to remember; it lasts until the page reloads.", error);
			}
		});

		input.click();
	}

	/// <summary>
	/// Go back to the preview's own background.
	/// </summary>
	function Reset()
	{
		document.body.classList.remove("has-dev-background");
		document.body.style.removeProperty("--dev-background");

		// See Pick.
		try
		{
			window.localStorage.removeItem(storageKey);
		}
		catch (error)
		{
			// Nothing was stored.
		}
	}

	// See Pick.
	try
	{
		const stored = window.localStorage.getItem(storageKey);

		if (stored)
		{
			Apply(stored);
		}
	}
	catch (error)
	{
		// No stored picture; the preview keeps its own background.
	}

	return { Pick, Reset };
})();
