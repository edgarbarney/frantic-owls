// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Emoji Picker
// ========================

/// <summary>
/// A panel of emoji above the composer, grouped into tabs, with the ones a player used last on a "Recent" tab.
/// Emoji are plain text, so they travel in an owl like any other character and need nothing from the server.
///
/// <para>
/// NOTE: The game's browser draws emoji with the system's colour emoji font (Segoe UI Emoji on Windows).
/// The list sticks to emoji that font has had for years, so they do not turn into empty boxes; only the wand and the feather need Windows 11.
/// </para>
///
/// </summary>
Owls.EmojiPicker = (() =>
{
	const { Element } = Owls.Util;

	/// <summary>
	/// localStorage key of the recently used emoji. Per player's browser only; losing it costs nothing.
	/// </summary>
	const recentStorageKey = "frantic-owls:recent-emoji";

	/// <summary>
	/// Most emoji kept on the "Recent" tab.
	/// </summary>
	const maxRecent = 24;

	/// <summary>
	/// The tabs and their emoji, in display order. Titles are text keys.
	/// </summary>
	const categories = Object.freeze
	([
		{ id: "magic", label: "\u{1F989}", title: "emoji.magic", emoji: ["🦉", "🪄", "✨", "🧙", "🧹", "🔮", "📜", "🕯️", "🌙", "⭐", "🌟", "⚡", "🔥", "🐉", "🦄", "🧪", "🐍", "🦁", "🦡", "🦅", "🏰", "🗝️", "📚", "🪶", "🍄", "🌿", "🕷️", "👻", "💀", "🎃", "☕", "🍫"] },
		{ id: "smileys", label: "\u{1F600}", title: "emoji.smileys", emoji: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😌", "😍", "🥰", "😘", "😋", "😛", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤯", "😳", "😱", "😨", "😰", "🤗", "🤔", "🤭", "🤫", "😶", "😐", "😑", "😬", "🙄", "😯", "😲", "🥱", "😴", "🤤", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕"] },
		{ id: "gestures", label: "\u{1F44B}", title: "emoji.gestures", emoji: ["👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👋", "👏", "🙌", "👐", "🤲", "🙏", "🤝", "💪", "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👀", "🤷", "🤦", "🙇"] },
		{ id: "hearts", label: "❤️", title: "emoji.hearts", emoji: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝"] },
		{ id: "things", label: "\u{1F381}", title: "emoji.things", emoji: ["🎉", "🎊", "🎁", "🏆", "⚽", "🍺", "🍷", "🍰", "🍪", "🍎", "🍞", "🧀", "🍗", "💰", "💎", "⚔️", "🛡️", "🏹", "💌", "✉️", "📍", "🗺️", "⏰", "⌛", "💤", "💯", "❗", "❓", "✅", "❌"] },
	]);

	/// <summary>
	/// The emoji this browser remembers using, newest first.
	/// </summary>
	/// <returns>Emoji strings</returns>
	function LoadRecent()
	{
		// Storage can be missing or refuse access (e.g. a locked-down profile); the tab simply starts empty then.
		try
		{
			const stored = JSON.parse(window.localStorage.getItem(recentStorageKey) || "[]");
			return Array.isArray(stored) ? stored.filter((emoji) => typeof emoji === "string").slice(0, maxRecent) : [];
		}
		catch (error)
		{
			return [];
		}
	}

	/// <summary>
	/// Remember the emoji used last.
	/// </summary>
	/// <param name="recent">Emoji strings, newest first</param>
	function SaveRecent(recent)
	{
		// Same as LoadRecent: a browser that will not store it just forgets.
		try
		{
			window.localStorage.setItem(recentStorageKey, JSON.stringify(recent));
		}
		catch (error)
		{
		}
	}

	/// <summary>
	/// Create a picker.
	/// </summary>
	/// <param name="OnPick">Called with the chosen emoji</param>
	/// <returns>{ element, Toggle, Hide, IsOpen }</returns>
	function Create(OnPick)
	{
		let recent = LoadRecent();
		let activeId = recent.length > 0 ? "recent" : categories[0].id;

		const tabs = Element("div", { className: "emoji-tabs" });
		const grid = Element("div", { className: "emoji-grid" });
		const element = Element("div", { className: "emoji-picker" }, [tabs, grid]);
		element.hidden = true;

		/// <summary>
		/// The tabs on offer: "Recent" only once something was used.
		/// </summary>
		/// <returns>Category list</returns>
		function GetCategories()
		{
			return recent.length > 0 ? [{ id: "recent", label: "\u{1F552}", title: "emoji.recent", emoji: recent }, ...categories] : categories;
		}

		/// <summary>
		/// Redraw the tabs and the active tab's emoji.
		/// </summary>
		function Render()
		{
			const available = GetCategories();
			const active = available.find((category) => category.id === activeId) || available[0];
			activeId = active.id;

			tabs.replaceChildren(...available.map((category) =>
			{
				const tab = Element("button", { className: `emoji-tab${category.id === activeId ? " is-active" : ""}`, text: category.label, title: Owls.Lang.T(category.title) });
				tab.addEventListener("click", () =>
				{
					activeId = category.id;
					Render();
				});
				return tab;
			}));

			grid.replaceChildren(...active.emoji.map((emoji) =>
			{
				const button = Element("button", { className: "emoji-option", text: emoji });
				button.addEventListener("click", () => Pick(emoji));
				return button;
			}));

			grid.scrollTop = 0;
		}

		/// <summary>
		/// Hand an emoji to the composer and move it to the front of "Recent".
		/// </summary>
		/// <param name="emoji">Chosen emoji</param>
		function Pick(emoji)
		{
			// "Recent" is not redrawn here: reshuffling it under the cursor would move the next pick. It catches up when the picker next opens.
			recent = [emoji, ...recent.filter((other) => other !== emoji)].slice(0, maxRecent);
			SaveRecent(recent);
			OnPick(emoji);
		}

		/// <summary>
		/// Show or hide the picker.
		/// </summary>
		function Toggle()
		{
			element.hidden = !element.hidden;

			if (!element.hidden)
			{
				Render();
			}
		}

		/// <summary>
		/// Hide the picker.
		/// </summary>
		function Hide()
		{
			element.hidden = true;
		}

		// Keep focus in the composer: buttons in the picker would otherwise steal it and drop the caret position.
		element.addEventListener("mousedown", (event) => event.preventDefault());

		return { element, Toggle, Hide, IsOpen: () => !element.hidden };
	}

	return { Create };
})();
