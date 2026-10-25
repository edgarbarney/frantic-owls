// FranticDreamer 2026
"use strict";

// ========================
// Settings Screen
// ========================

/// <summary>
/// The player's own owl, split into categories like a phone's Settings app.
/// The first page shows the crest, the player's card (opening Profile) and one row per category;
/// each category opens as its own page: Profile, Appearance, Language, Notifications, Floo-Calls, Do Not Disturb, and Privacy &amp; Blocking.
/// Every change is saved on the server straight away; a failed save puts the old value back.
/// </summary>
Owls.Screens.Settings = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// Delay before a volume change is saved, so dragging the slider sends one request rather than dozens.
	/// </summary>
	const volumeSaveDelayMs = 400;

	/// <summary>
	/// Themes offered in the picker, in display order. Labels are text keys.
	/// </summary>
	const themeChoices = Object.freeze
	([
		{ id: "muggle", label: "theme.muggle" },
		{ id: "parchment", label: "theme.parchment" },
	]);

	/// <summary>
	/// Colour schemes of the Muggle Phone theme, in display order. Labels are text keys.
	/// </summary>
	const schemeChoices = Object.freeze
	([
		{ id: "default", label: "scheme.default" },
		{ id: "gryffindor", label: "scheme.gryffindor" },
		{ id: "slytherin", label: "scheme.slytherin" },
		{ id: "ravenclaw", label: "scheme.ravenclaw" },
		{ id: "hufflepuff", label: "scheme.hufflepuff" },
	]);

	/// <summary>
	/// Credits line shown faintly at the bottom of the first page.
	/// </summary>
	const credits = "Frantic’s Wizarding Communication by FranticDreamer\nDiscord: franticdreamer\nGitHub: edgarbarney";

	/// <summary>
	/// Build a labelled on/off switch row.
	/// </summary>
	/// <param name="title">Setting name</param>
	/// <param name="hint">One-line explanation</param>
	/// <param name="onToggle">Called with the new value</param>
	/// <returns>{ element, Set(value) }</returns>
	function CreateToggle(title, hint, onToggle)
	{
		const toggle = Element("button", { className: "toggle", title, attributes: { role: "switch", "aria-checked": "false" } });
		let value = false;

		toggle.addEventListener("click", () => onToggle(!value));

		const element = Element("div", { className: "setting-row" },
		[
			Element("span", { className: "setting-text" }, [Element("span", { className: "row-title", text: title }), Element("span", { className: "row-subtitle", text: hint })]),
			toggle,
		]);

		return {
			element,
			Set: (next) =>
			{
				value = next;
				toggle.classList.toggle("is-on", next);
				toggle.setAttribute("aria-checked", String(next));
			},
		};
	}

	/// <summary>
	/// Build one row of the category list: an icon on an accent square, the category's name, its current value and a chevron.
	/// </summary>
	/// <param name="icon">Icon markup</param>
	/// <param name="title">Category name</param>
	/// <param name="value">Current value shown under the name ("" for none)</param>
	/// <param name="onClick">Click handler</param>
	/// <returns>Row element</returns>
	function CreateNavRow(icon, title, value, onClick)
	{
		const iconHolder = Element("span", { className: "settings-nav-icon" });
		const chevron = Element("span", { className: "settings-nav-chevron" });
		iconHolder.innerHTML = icon;
		chevron.innerHTML = Owls.Icons.chevronRight;

		return Element("button", { className: "settings-nav-row", on: { click: onClick } },
		[
			iconHolder,
			Element("span", { className: "setting-text" }, [Element("span", { className: "row-title", text: title }), value ? Element("span", { className: "row-subtitle", text: value }) : null]),
			chevron,
		]);
	}

	/// <summary>
	/// Create the screen: the category list, or one category's page.
	/// </summary>
	/// <param name="params">{ section } where section is "" for the first page, or "profile", "appearance", "language", "notifications", "calls", "quiet" or "privacy"</param>
	/// <returns>Screen instance</returns>
	function Create(params = {})
	{
		const store = Owls.Store;
		const config = store.state.config;
		const ui = config.ui || {};
		const section = String(params.section || "");
		const error = Element("div", { className: "form-error" });
		let volumeTimer = null;
		let ringtoneVolumeTimer = null;
		let callVolumeTimer = null;
		let effectsVolumeTimer = null;
		let isSavingPicture = false;

		/// <summary>
		/// Save a partial settings change, rolling back the display if the server refuses it.
		/// </summary>
		/// <param name="changes">Changed keys</param>
		async function Save(changes)
		{
			const previous = { ...store.state.settings };
			error.textContent = "";
			store.SetSettings({ ...previous, ...changes });

			const result = await Owls.Bridge.Request("settings.update", { settings: changes });

			if (!result.ok)
			{
				error.textContent = result.error;
				store.SetSettings(previous);
				return;
			}

			store.SetSettings(result.data.settings);
		}

		// ========================
		// Crest & Player Card
		// ========================

		// The crest sits here in both themes; Muggle Phone keeps it off its home screen, which only shows the apps.
		const crestOwner = Element("div", { className: "crest-owner" });
		const crestSection = Element("div", { className: "settings-crest" },
		[
			Element("div", { className: "crest-title", text: T("home.crestTitle") }),
			Element("div", { className: "crest-subtitle", text: T("home.crestSubtitle") }),
			crestOwner,
		]);

		const meAvatar = Element("span");
		const meName = Element("span", { className: "row-title" });
		const meNumber = Element("span", { className: "row-subtitle" });
		const cardChevron = Element("span", { className: "settings-nav-chevron" });
		cardChevron.innerHTML = Owls.Icons.chevronRight;

		// On the first page the card opens Profile; on Profile itself it is only the preview of the picture being typed.
		const card = Element(section === "" ? "button" : "div", { className: "settings-card", on: section === "" ? { click: () => Owls.App.Navigate("Settings", { section: "profile" }) } : {} },
		[
			meAvatar,
			Element("span", { className: "setting-text" }, [meName, meNumber]),
			section === "" ? cardChevron : null,
		]);

		// ========================
		// Profile
		// ========================

		const pictureInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.maxAvatarUrlLength || 512, placeholder: "https://i.imgur.com/example.gif" } });
		const pictureButton = Element("button", { className: "secondary-button", text: T("common.save") });

		/// <summary>
		/// Redraw the card's picture: the link being typed on Profile, the saved picture elsewhere, so a broken link shows before saving.
		/// </summary>
		function UpdatePicturePreview()
		{
			const me = store.state.me;
			const url = section === "profile" ? pictureInput.value.trim() : me.avatarUrl || "";
			meAvatar.replaceChildren(Owls.Util.CreateAvatar(me.name, url, me.number, "", Owls.Icons.owl));
		}

		/// <summary>
		/// Save the player's own profile picture.
		/// </summary>
		async function SavePicture()
		{
			if (isSavingPicture)
			{
				return;
			}

			isSavingPicture = true;
			pictureButton.disabled = true;
			error.textContent = "";

			const result = await Owls.Bridge.Request("profile.update", { avatarUrl: pictureInput.value });

			isSavingPicture = false;
			pictureButton.disabled = false;

			if (!result.ok)
			{
				error.textContent = result.error;
				return;
			}

			pictureInput.value = result.data.avatarUrl;
			store.SetProfile(store.state.me.number, result.data.avatarUrl);
		}

		pictureInput.value = store.state.me.avatarUrl || "";
		pictureInput.addEventListener("input", UpdatePicturePreview);
		pictureInput.addEventListener("keydown", (event) =>
		{
			if (event.key === "Enter")
			{
				SavePicture();
			}
		});
		pictureButton.addEventListener("click", SavePicture);

		const profileSection = Element("div", { className: "settings-section" },
		[
			Element("span", { className: "field-label", text: T("settings.pictureLabel") }),
			Element("div", { className: "profile-row" }, [pictureInput, pictureButton]),
			Element("span", { className: "field-hint", text: T("settings.pictureHint") }),
		]);

		// ========================
		// Appearance
		// ========================

		const themeButtons = themeChoices.map((choice) =>
		{
			const button = Element("button", { on: { click: () => Save({ theme: choice.id }) } });
			button.innerHTML = Owls.Icons.palette;
			button.appendChild(Element("span", { text: T(choice.label) }));
			button.dataset.theme = choice.id;
			return button;
		});

		const schemeDropdown = Widgets.Dropdown(schemeChoices.map((choice) => ({ value: choice.id, label: T(choice.label) })), (id) =>
		{
			if (id !== store.GetColourScheme())
			{
				Save({ colourScheme: id });
			}
		}, Owls.Icons.droplet);

		const animationsToggle = CreateToggle(T("settings.animations"), T("settings.animationsHint"), (value) => Save({ animations: value }));

		// Only Muggle Phone has colour schemes and motion; the fields hide themselves while Parchment is chosen.
		const schemeField = Element("div", { className: "settings-section" },
		[
			Element("span", { className: "field-label", text: T("settings.schemeLabel") }),
			schemeDropdown.element,
			animationsToggle.element,
		]);

		const wallpaperInput = Element("input", { className: "text-input", attributes: { type: "text", maxlength: config.maxAvatarUrlLength || 512, placeholder: "https://i.imgur.com/example.jpg" } });
		const wallpaperButton = Element("button", { className: "secondary-button", text: T("common.save"), on: { click: () => Save({ wallpaperUrl: wallpaperInput.value.trim() }) } });

		wallpaperInput.addEventListener("keydown", (event) =>
		{
			if (event.key === "Enter")
			{
				Save({ wallpaperUrl: wallpaperInput.value.trim() });
			}
		});

		const lockToggle = CreateToggle(T("settings.lockScreen"), T("settings.lockScreenHint"), (value) => Save({ lockScreen: value }));
		const moveButton = Element("button", { className: "secondary-button", on: { click: () => Owls.LayoutEditor.Request() } });
		moveButton.innerHTML = Owls.Icons.move;
		moveButton.appendChild(Element("span", { text: T("settings.move") }));

		const appearanceSection = Element("div", { className: "settings-section" },
		[
			Element("span", { className: "field-label", text: T("settings.themeLabel") }),
			Element("div", { className: "segmented" }, themeButtons),
			schemeField,
			ui.lockScreen !== false ? lockToggle.element : null,
			Element("span", { className: "field-label", text: T("settings.wallpaperLabel") }),
			Element("div", { className: "profile-row" }, [wallpaperInput, wallpaperButton]),
			Element("span", { className: "field-hint", text: T("settings.wallpaperHint") }),
			ui.allowMove ? moveButton : null,
			ui.allowMove ? Element("span", { className: "field-hint", text: T("settings.moveHint", { command: `/${config.command || "owl"}_resetpos` }) }) : null,
		]);

		// ========================
		// Language
		// ========================

		const languages = Array.isArray(config.languages) ? config.languages : [];

		// Each language is named in its own words, so a player who cannot read the current one still finds theirs.
		const languageDropdown = Widgets.Dropdown(languages.map((language) => ({ value: language.id, label: language.name })), (id) =>
		{
			if (id !== Owls.Lang.GetId())
			{
				Save({ language: id });
			}
		}, Owls.Icons.language);
		const languageSection = Element("div", { className: "settings-section" }, [Element("span", { className: "field-label", text: T("settings.languageLabel") }), languageDropdown.element]);

		// ========================
		// Notifications
		// ========================

		const soundToggle = CreateToggle(T("settings.sound"), T("settings.soundHint"), (value) => Save({ notificationSound: value }));
		const sounds = Array.isArray(config.sounds) ? config.sounds : [];

		// Each choice plays itself when picked (again, if it was already chosen), so players hear what they chose.
		const soundDropdown = Widgets.Dropdown(sounds.map((sound) => ({ value: sound.id, label: sound.label })), (id) =>
		{
			Owls.Notifications.PlaySound(id);

			if (id !== store.state.settings.sound)
			{
				Save({ sound: id });
			}
		}, Owls.Icons.bell);
		const soundField = Element("div", { className: "field" }, [Element("span", { className: "field-label", text: T("settings.soundLabel") }), soundDropdown.element]);
		const popupToggle = CreateToggle(T("settings.popups"), T("settings.popupsHint"), (value) => Save({ popups: value }));
		const volume = Element("input", { className: "slider", attributes: { type: "range", min: 0, max: 100, step: 5 } });
		const testButton = Element("button", { className: "secondary-button", text: T("settings.testSound"), on: { click: () => Owls.Notifications.PlaySound(store.state.settings.sound || "") } });

		volume.addEventListener("input", () =>
		{
			const value = Number(volume.value) / 100;
			store.state.settings.notificationVolume = value;
			clearTimeout(volumeTimer);
			volumeTimer = setTimeout(() =>
			{
				volumeTimer = null;
				Save({ notificationVolume: value });
			}, volumeSaveDelayMs);
		});

		const volumeField = Element("label", { className: "field" }, [Element("span", { className: "field-label", text: T("settings.volumeLabel") }), volume]);

		// Only a sound file played by the page has an adjustable volume; Wwise events play at the game's own levels.
		volumeField.hidden = config.soundMode !== "file";
		soundField.hidden = config.soundMode !== "file" || sounds.length < 2;
		testButton.hidden = config.soundMode === "none";
		soundToggle.element.hidden = config.soundMode === "none";

		// Phone sounds: key taps, app taps, locking and owls in the chat on screen. Hidden when the server ships none.
		const hasEffects = Object.values(config.effects || {}).some((set) => Object.keys(set || {}).length > 0);
		const effectsToggle = CreateToggle(T("settings.effects"), T("settings.effectsHint"), (value) => Save({ soundEffects: value }));
		const effectsVolume = Element("input", { className: "slider", attributes: { type: "range", min: 0, max: 100, step: 5 } });

		effectsVolume.addEventListener("input", () =>
		{
			const value = Number(effectsVolume.value) / 100;
			store.state.settings.effectsVolume = value;

			// The tap itself is the preview, so players hear the level they are choosing.
			Owls.Effects.Play("keyTap");
			clearTimeout(effectsVolumeTimer);
			effectsVolumeTimer = setTimeout(() =>
			{
				effectsVolumeTimer = null;
				Save({ effectsVolume: value });
			}, volumeSaveDelayMs);
		});

		const effectsVolumeField = Element("label", { className: "field" }, [Element("span", { className: "field-label", text: T("settings.effectsVolumeLabel") }), effectsVolume]);
		const notificationsSection = Element("div", { className: "settings-section" }, [soundToggle.element, soundField, volumeField, popupToggle.element, testButton, hasEffects ? effectsToggle.element : null, hasEffects ? effectsVolumeField : null]);

		// ========================
		// Floo-Calls
		// ========================

		const ringtones = Array.isArray(config.ringtones) ? config.ringtones : [];

		// Like notification sounds, each ringtone plays once when picked, so players hear what they chose.
		const ringtoneDropdown = Widgets.Dropdown(ringtones.map((ringtone) => ({ value: ringtone.id, label: ringtone.label })), (id) =>
		{
			Owls.Notifications.PreviewRingtone(id);

			if (id !== store.state.settings.ringtone)
			{
				Save({ ringtone: id });
			}
		}, Owls.Icons.flame);
		const ringtoneField = Element("div", { className: "field" }, [Element("span", { className: "field-label", text: T("settings.ringtoneLabel") }), ringtoneDropdown.element]);
		const ringtoneVolume = Element("input", { className: "slider", attributes: { type: "range", min: 0, max: 100, step: 5 } });
		const ringtoneTestButton = Element("button", { className: "secondary-button", text: T("settings.testRingtone"), on: { click: () => Owls.Notifications.PreviewRingtone(store.state.settings.ringtone || "") } });

		ringtoneVolume.addEventListener("input", () =>
		{
			const value = Number(ringtoneVolume.value) / 100;
			store.state.settings.ringtoneVolume = value;
			clearTimeout(ringtoneVolumeTimer);
			ringtoneVolumeTimer = setTimeout(() =>
			{
				ringtoneVolumeTimer = null;
				Save({ ringtoneVolume: value });
			}, volumeSaveDelayMs);
		});

		const ringtoneVolumeField = Element("label", { className: "field" }, [Element("span", { className: "field-label", text: T("settings.ringtoneVolumeLabel") }), ringtoneVolume]);
		const ringtoneHint = Element("span", { className: "field-hint", text: T("settings.ringtoneHint") });
		const callVolume = Element("input", { className: "slider", attributes: { type: "range", min: 0, max: 100, step: 5 } });

		// Applied as it moves, so a player can set it during a call by ear.
		callVolume.addEventListener("input", () =>
		{
			const value = Number(callVolume.value) / 100;
			store.state.settings.callVolume = value;
			Owls.Voice.ApplyVolume();
			clearTimeout(callVolumeTimer);
			callVolumeTimer = setTimeout(() =>
			{
				callVolumeTimer = null;
				Save({ callVolume: value });
			}, volumeSaveDelayMs);
		});

		const callVolumeField = Element("label", { className: "field" }, [Element("span", { className: "field-label", text: T("settings.callVolumeLabel") }), callVolume]);

		// Ringtones are sound files the page plays; a server playing Wwise events (or nothing) has no ringtone to pick.
		const hasRingtones = config.soundMode === "file" && ringtones.length > 0;
		const hasVoice = config.voiceEnabled !== false;

		for (const part of [ringtoneHint, ringtoneField, ringtoneVolumeField, ringtoneTestButton])
		{
			part.hidden = !hasRingtones;
		}

		callVolumeField.hidden = !hasVoice;

		const callsSection = Element("div", { className: "settings-section" }, [ringtoneHint, ringtoneField, ringtoneVolumeField, ringtoneTestButton, callVolumeField]);

		// ========================
		// Do Not Disturb
		// ========================

		const quietToggle = CreateToggle(T("settings.doNotDisturb"), T("settings.doNotDisturbHint"), (value) => Save({ doNotDisturb: value }));
		const activityToggle = CreateToggle(T("settings.quietActivities"), T("settings.quietActivitiesHint"), (value) => Save({ quietDuringActivities: value }));
		const quietSection = Element("div", { className: "settings-section" }, [quietToggle.element, config.quietActivities ? activityToggle.element : null]);

		// ========================
		// Privacy & Blocking
		// ========================

		const receiptsToggle = CreateToggle(T("settings.readReceipts"), T("settings.readReceiptsHint"), (value) => Save({ readReceipts: value }));
		const typingToggle = CreateToggle(T("settings.typing"), T("settings.typingHint"), (value) => Save({ typingIndicators: value }));
		const blockedList = Element("div", { className: "blocked-list" });

		const privacySection = Element("div", { className: "settings-section" },
		[
			config.readReceipts !== false ? receiptsToggle.element : null,
			config.typingIndicators !== false ? typingToggle.element : null,
			Element("span", { className: "field-label", text: T("settings.blockedLabel") }),
			blockedList,
		]);

		/// <summary>
		/// List blocked owls, each with an Unblock button.
		/// </summary>
		function RenderBlocked()
		{
			const numbers = [...store.state.blocked];

			if (numbers.length === 0)
			{
				blockedList.replaceChildren(Element("span", { className: "field-hint", text: T("settings.blockedEmpty") }));
				return;
			}

			blockedList.replaceChildren(...numbers.map((number) =>
			{
				const unblock = Element("button", { className: "secondary-button inform-button", text: T("common.unblock") });

				unblock.addEventListener("click", async () =>
				{
					unblock.disabled = true;
					const result = await Owls.Bridge.Request("blocks.remove", { number });
					unblock.disabled = false;

					if (!result.ok)
					{
						error.textContent = result.error;
						return;
					}

					store.SetBlocked(number, false);
				});

				return Element("div", { className: "setting-row" }, [Element("span", { className: "row-title", text: store.GetDisplayName(number) }), unblock]);
			}));
		}

		// ========================
		// Categories
		// ========================

		/// <summary>
		/// Every category: its icon, title key, page content and whether this server offers it.
		/// </summary>
		const categories =
		[
			{ id: "profile", icon: Owls.Icons.person, title: "settings.section.profile", content: [card, profileSection], isShown: false },
			{ id: "appearance", icon: Owls.Icons.palette, title: "settings.section.appearance", content: [appearanceSection], isShown: true },
			{ id: "language", icon: Owls.Icons.language, title: "settings.section.language", content: [languageSection], isShown: languages.length > 1 },
			{ id: "notifications", icon: Owls.Icons.bell, title: "settings.section.notifications", content: [notificationsSection], isShown: true },
			{ id: "calls", icon: Owls.Icons.flame, title: "settings.section.calls", content: [callsSection], isShown: config.callsEnabled !== false && (hasRingtones || hasVoice) },
			{ id: "quiet", icon: Owls.Icons.moon, title: "settings.section.quiet", content: [quietSection], isShown: true },
			{ id: "privacy", icon: Owls.Icons.shield, title: "settings.section.privacy", content: [privacySection], isShown: true },
		];

		const current = categories.find((category) => category.id === section) || null;
		const navList = Element("div", { className: "settings-nav" });

		/// <summary>
		/// The value a category row shows under its name, so the first page tells what is set without opening anything.
		/// </summary>
		/// <param name="id">Category ID</param>
		/// <returns>Value text, or ""</returns>
		function GetCategoryValue(id)
		{
			const settings = store.state.settings;

			switch (id)
			{
			case "appearance":
			{
				const theme = themeChoices.find((choice) => choice.id === store.GetTheme());
				const scheme = schemeChoices.find((choice) => choice.id === store.GetColourScheme());
				return theme && theme.id === "muggle" && scheme ? T("settings.appearanceValue", { theme: T(theme.label), scheme: T(scheme.label) }) : theme ? T(theme.label) : "";
			}
			case "language":
			{
				const language = languages.find((candidate) => candidate.id === Owls.Lang.GetId());
				return language ? language.name : "";
			}
			case "quiet":
				return store.IsQuiet() ? T("settings.on") : T("settings.off");
			case "calls":
			{
				const ringtone = ringtones.find((candidate) => candidate.id === settings.ringtone) || ringtones.find((candidate) => candidate.id === config.defaultRingtone);
				return hasRingtones && ringtone ? ringtone.label : "";
			}
			default:
				return "";
			}
		}

		/// <summary>
		/// Redraw the rows of the first page.
		/// </summary>
		function RenderNav()
		{
			navList.replaceChildren(...categories.filter((category) => category.isShown).map((category) => CreateNavRow(category.icon, T(category.title), GetCategoryValue(category.id), () => Owls.App.Navigate("Settings", { section: category.id }))));
		}

		const pageContent = current
			? [...current.content, error]
			: [crestSection, card, navList, error, Element("div", { className: "credits", text: credits })];

		const element = Element("div", { className: "screen" },
		[
			Widgets.Header(current ? T(current.title) : T("home.settings")).element,
			Element("div", { className: "screen-body" }, [Element("div", { className: "settings" }, pageContent)]),
		]);

		/// <summary>
		/// Show the stored settings and the player's card.
		/// </summary>
		/// <param name="reason">Change reason</param>
		function Refresh(reason)
		{
			if (reason === "blocks" || reason === "contacts")
			{
				RenderBlocked();
				return;
			}

			if (reason !== "settings" && reason !== "profiles" && reason !== "quiet" && reason !== "reset" && reason !== "ready")
			{
				return;
			}

			RenderBlocked();
			RenderNav();

			const me = store.state.me;
			const settings = store.state.settings;
			const theme = store.GetTheme();

			meName.textContent = me.name || T("settings.yourOwl");
			meNumber.textContent = config.numbersVisible && me.number ? T("owl.numbered", { number: store.FormatNumber(me.number) }) : T("settings.ready");
			crestOwner.textContent = me.name ? T("home.owner", { name: me.name }) : "";
			UpdatePicturePreview();

			// Keep a link the player is still typing.
			if (document.activeElement !== wallpaperInput)
			{
				wallpaperInput.value = settings.wallpaperUrl || "";
			}

			soundToggle.Set(!!settings.notificationSound);
			popupToggle.Set(!!settings.popups);
			receiptsToggle.Set(settings.readReceipts !== false);
			typingToggle.Set(settings.typingIndicators !== false);
			quietToggle.Set(!!settings.doNotDisturb);
			activityToggle.Set(settings.quietDuringActivities !== false);
			languageDropdown.Set(Owls.Lang.GetId());
			soundDropdown.Set(sounds.some((sound) => sound.id === settings.sound) ? settings.sound : config.defaultSound);
			ringtoneDropdown.Set(ringtones.some((ringtone) => ringtone.id === settings.ringtone) ? settings.ringtone : config.defaultRingtone);
			schemeDropdown.Set(store.GetColourScheme());
			animationsToggle.Set(settings.animations !== false);
			lockToggle.Set(settings.lockScreen !== false);
			effectsToggle.Set(settings.soundEffects !== false);
			effectsVolumeField.hidden = settings.soundEffects === false;
			schemeField.hidden = theme !== "muggle";

			for (const button of themeButtons)
			{
				button.classList.toggle("is-active", button.dataset.theme === theme);
			}

			// Do not yank the slider out from under a drag in progress.
			if (volumeTimer === null)
			{
				volume.value = String(Math.round(Number(settings.notificationVolume) * 100));
			}

			if (ringtoneVolumeTimer === null)
			{
				ringtoneVolume.value = String(Math.round(Number(settings.ringtoneVolume ?? 0.8) * 100));
			}

			if (callVolumeTimer === null)
			{
				callVolume.value = String(Math.round(Number(settings.callVolume ?? 1) * 100));
			}

			if (effectsVolumeTimer === null)
			{
				effectsVolume.value = String(Math.round(Number(settings.effectsVolume ?? 0.5) * 100));
			}
		}

		Refresh("settings");
		return {
			element,
			Refresh,
			Destroy: () =>
			{
				languageDropdown.Close();
				soundDropdown.Close();
				ringtoneDropdown.Close();
				schemeDropdown.Close();
				Owls.Notifications.StopPreview();

				// Save a slider change that was still waiting for its delay.
				if (volumeTimer !== null)
				{
					clearTimeout(volumeTimer);
					Save({ notificationVolume: Number(volume.value) / 100 });
				}

				if (ringtoneVolumeTimer !== null)
				{
					clearTimeout(ringtoneVolumeTimer);
					Save({ ringtoneVolume: Number(ringtoneVolume.value) / 100 });
				}

				if (callVolumeTimer !== null)
				{
					clearTimeout(callVolumeTimer);
					Save({ callVolume: Number(callVolume.value) / 100 });
				}

				if (effectsVolumeTimer !== null)
				{
					clearTimeout(effectsVolumeTimer);
					Save({ effectsVolume: Number(effectsVolume.value) / 100 });
				}
			},
		};
	}

	return { Create };
})();
