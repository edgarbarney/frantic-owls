// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};
Owls.DeskScreens = Owls.DeskScreens || {};

// ========================
// Settings Screen
// ========================

/// <summary>
/// The letter desk's few settings: language, the sound an arriving owl makes, notices and Do Not Disturb.
/// They are the same stored settings the phone uses, so a server switching mode keeps every player's choices.
/// </summary>
Owls.DeskScreens.Settings = (() =>
{
	const { Element } = Owls.Util;
	const T = Owls.Lang.T;
	const Store = Owls.MailStore;

	/// <summary>
	/// Build the screen.
	/// </summary>
	/// <param name="desk">Owls.Desk, for navigation, messages and sounds</param>
	/// <returns>{ element, OnStore(reason), Destroy() }</returns>
	function Create(desk)
	{
		const body = Element("div", { className: "settings-body" });
		const element = Element("section", { className: "settings" },
		[
			Element("div", { className: "desk-toolbar" },
			[
				Element("button", { className: "desk-button is-quiet", on: { click: () => desk.ShowLetters({}) } },
				[
					Element("i", { className: "fa-solid fa-arrow-left", attributes: { "aria-hidden": "true" } }),
					Element("span", { text: T("mail.reader.back") }),
				]),
				Element("span", { className: "compose-title", text: T("mail.settings.title") }),
			]),
			body,
		]);

		/// <summary>
		/// Save some settings, keeping the screen in step with what the server stored.
		/// </summary>
		/// <param name="changes">Settings to change</param>
		async function Save(changes)
		{
			const result = await Owls.Bridge.Request("settings.update", { settings: changes });

			if (!result.ok)
			{
				desk.ShowError(result.error);
				Render();
				return;
			}

			Store.SetSettings(result.data.settings);
		}

		/// <summary>
		/// One labelled row.
		/// </summary>
		/// <param name="label">Label</param>
		/// <param name="hint">Explanation under it ("" for none)</param>
		/// <param name="control">Control on the right</param>
		/// <returns>Row element</returns>
		function Row(label, hint, control)
		{
			return Element("div", { className: "settings-row" },
			[
				Element("span", { className: "settings-text" },
				[
					Element("span", { className: "settings-label", text: label }),
					hint ? Element("span", { className: "settings-hint", text: hint }) : null,
				]),
				control,
			]);
		}

		/// <summary>
		/// An on/off switch bound to one boolean setting.
		/// </summary>
		/// <param name="key">Setting key</param>
		/// <returns>Checkbox element</returns>
		function Toggle(key)
		{
			const input = Element("input", { className: "settings-toggle", attributes: { type: "checkbox" } });
			input.checked = !!Store.state.settings[key];
			input.addEventListener("change", () => Save({ [key]: input.checked }));
			return input;
		}

		/// <summary>
		/// A drop-down list bound to one setting.
		/// </summary>
		/// <param name="key">Setting key</param>
		/// <param name="options">[{ value, label }]</param>
		/// <returns>Select element</returns>
		function Choice(key, options)
		{
			const select = Element("select", { className: "settings-select" }, options.map((option) => Element("option", { text: option.label, attributes: { value: option.value } })));
			select.value = String(Store.state.settings[key] || "");
			select.addEventListener("change", () => Save({ [key]: select.value }));
			return select;
		}

		/// <summary>
		/// Draw every row from the current settings.
		/// </summary>
		function Render()
		{
			const config = Store.state.config;
			const settings = Store.state.settings;
			const languages = Array.isArray(config.languages) ? config.languages : [];
			const sounds = Array.isArray(config.sounds) ? config.sounds : [];
			const volume = Element("input", { className: "settings-range", attributes: { type: "range", min: "0", max: "1", step: "0.05" } });
			volume.value = String(settings.notificationVolume);
			volume.addEventListener("change", () => Save({ notificationVolume: Number(volume.value) }));

			const soundRow = Element("span", { className: "settings-inline" },
			[
				Choice("sound", [{ value: "", label: T("mail.settings.defaultSound") }, ...sounds.map((sound) => ({ value: sound.id, label: sound.label }))]),
				Element("button", { className: "desk-icon", title: T("settings.testSound"), on: { click: () => desk.PlaySound(settings.sound || config.defaultSound || "") } }, [Element("i", { className: "fa-solid fa-play" })]),
			]);

			const rows =
			[
				Row(T("settings.section.language"), "", Choice("language", [{ value: "", label: T("mail.settings.serverLanguage") }, ...languages.map((language) => ({ value: language.id, label: language.name }))])),
				Row(T("settings.sound"), T("mail.settings.soundHint"), Toggle("notificationSound")),
				config.soundMode === "file" ? Row(T("mail.settings.soundChoice"), "", soundRow) : null,
				config.soundMode === "file" ? Row(T("mail.settings.volume"), "", volume) : null,
				Row(T("mail.settings.notices"), T("mail.settings.noticesHint"), Toggle("popups")),
				Row(T("settings.doNotDisturb"), T("mail.settings.doNotDisturbHint"), Toggle("doNotDisturb")),
				config.quietActivities ? Row(T("settings.quietActivities"), T("settings.quietActivitiesHint"), Toggle("quietDuringActivities")) : null,
			];

			body.replaceChildren(...rows.filter(Boolean));
		}

		Render();

		return {
			element,
			OnStore: (reason) =>
			{
				if (reason === "settings")
				{
					Render();
				}
			},
			Destroy: () => {},
		};
	}

	return { Create };
})();
