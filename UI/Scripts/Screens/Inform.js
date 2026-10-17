// FranticDreamer 2026
"use strict";

// ========================
// Inform Screen
// ========================

/// <summary>
/// Hand your owl to a nearby player. The list refreshes on the server-configured interval (network.nearbyRefreshMs)
/// while the screen is open, and each player shows a countdown while the per-person cooldown runs.
/// Above the list sit the owls others offered you that wait for your answer: accept, exchange (accept and give yours back) or decline.
/// </summary>
Owls.Screens.Inform = (() =>
{
	const { Element } = Owls.Util;
	const Widgets = Owls.Widgets;
	const T = Owls.Lang.T;

	/// <summary>
	/// Create the screen.
	/// </summary>
	/// <returns>Screen instance</returns>
	function Create()
	{
		const config = Owls.Store.state.config;
		const refreshMs = config.nearbyRefreshMs || 1000;

		/// <summary>
		/// Local cooldown end times by player ID, so countdowns tick between refreshes.
		/// </summary>
		const cooldownEnds = new Map();

		let players = [];
		let rangeMetres = 0;
		let isFetching = false;
		let isDestroyed = false;
		let hasLoaded = false;
		let refreshTimer = null;
		let tickTimer = null;

		const list = Element("div");
		const requestList = Element("div", { className: "inform-requests" });
		const status = Element("div", { className: "inform-status" });
		const intro = Element("div", { className: "inform-intro" });
		const element = Element("div", { className: "screen" }, [Widgets.Header(T("inform.title")).element, intro, status, Element("div", { className: "screen-body" }, [requestList, list])]);

		/// <summary>
		/// Request IDs with an answer on its way, so their buttons stay disabled across redraws.
		/// </summary>
		const answering = new Set();

		/// <summary>
		/// Show a result line above the list.
		/// </summary>
		/// <param name="text">Message</param>
		/// <param name="tone">"success", "error" or ""</param>
		function SetStatus(text, tone)
		{
			status.textContent = text;
			status.className = `inform-status${tone ? ` is-${tone}` : ""}`;
		}

		/// <summary>
		/// Seconds left on a player's cooldown, according to the local clock.
		/// </summary>
		/// <param name="playerId">Player ID</param>
		/// <returns>Whole seconds, 0 when ready</returns>
		function GetRemaining(playerId)
		{
			const end = cooldownEnds.get(playerId) || 0;
			return Math.max(0, Math.ceil((end - Date.now()) / 1000));
		}

		/// <summary>
		/// Inform one player.
		/// </summary>
		/// <param name="player">Nearby player entry</param>
		/// <param name="button">The row's button, disabled while waiting</param>
		async function Send(player, button)
		{
			button.disabled = true;
			SetStatus(T("inform.sending"), "");

			const result = await Owls.Bridge.Request("inform.send", { playerId: player.playerId });
			const cooldown = Number(result.data && result.data.cooldownSeconds) || 0;

			if (cooldown > 0)
			{
				cooldownEnds.set(player.playerId, Date.now() + cooldown * 1000);
			}

			if (!result.ok)
			{
				SetStatus(result.error, "error");
			}
			// The server leaves the name empty when it keeps nearby players anonymous (inform.revealNames off).
			else if (result.data.status === "already-known")
			{
				SetStatus(result.data.name ? T("inform.alreadyKnown", { name: result.data.name }) : T("inform.alreadyKnownAnonymous"), "");
			}
			else if (result.data.status === "requested")
			{
				SetStatus(result.data.name ? T("inform.requested", { name: result.data.name }) : T("inform.requestedAnonymous"), "success");
			}
			else
			{
				SetStatus(result.data.name ? T("inform.sent", { name: result.data.name }) : T("inform.sentAnonymous"), "success");
			}

			Render();
		}

		/// <summary>
		/// Answer an owl someone offered.
		/// </summary>
		/// <param name="request">Waiting request</param>
		/// <param name="choice">"accept", "exchange" or "decline"</param>
		async function Answer(request, choice)
		{
			answering.add(request.id);
			RenderRequests();

			const result = await Owls.Bridge.Request("inform.respond", { requestId: request.id, choice });
			answering.delete(request.id);

			// Answered, expired or gone: in every case except a retryable failure, the request is over.
			if (result.ok || (result.data && result.data.requestId))
			{
				Owls.Store.RemoveInformRequest(request.id);
			}

			if (!result.ok)
			{
				SetStatus(result.error, "error");
				RenderRequests();
				return;
			}

			if (result.data.contact)
			{
				Owls.Store.UpsertContact(result.data.contact);
			}

			if (choice === "decline")
			{
				SetStatus(T("inform.declined", { name: request.name }), "");
			}
			else if (choice === "exchange")
			{
				SetStatus(result.data.exchanged ? T("inform.exchanged", { name: request.name }) : T("inform.exchangeFailed", { name: request.name }), result.data.exchanged ? "success" : "");
			}
			else
			{
				SetStatus(T("inform.accepted", { name: request.name }), "success");
			}

			RenderRequests();
		}

		/// <summary>
		/// Redraw the owls waiting for an answer, each with the seconds it has left.
		/// </summary>
		function RenderRequests()
		{
			const requests = Owls.Store.GetInformRequests();

			if (requests.length === 0)
			{
				requestList.replaceChildren();
				return;
			}

			const now = Owls.Store.GetServerNow();

			requestList.replaceChildren(Element("span", { className: "field-label", text: T("inform.waitingLabel") }), ...requests.map((request) =>
			{
				const isBusy = answering.has(request.id);
				const secondsLeft = Math.max(0, Math.ceil((Number(request.expiresAt) - now) / 1000));
				const AnswerButton = (className, text, choice) => Element("button", { className, text, attributes: isBusy ? { disabled: "" } : {}, on: { click: () => Answer(request, choice) } });

				return Element("div", { className: "inform-request" },
				[
					Element("div", { className: "inform-request-head" },
					[
						Owls.Util.CreateAvatar(request.name, request.avatarUrl || "", request.name, "is-small"),
						Element("span", { className: "row-text" },
						[
							Element("span", { className: "row-title", text: request.name }),
							Element("span", { className: "row-subtitle", text: T("inform.requestRow", { count: secondsLeft }) }),
						]),
					]),
					Element("div", { className: "button-row" },
					[
						AnswerButton("secondary-button", T("inform.decline"), "decline"),
						request.canExchange ? AnswerButton("secondary-button", T("inform.exchange"), "exchange") : null,
						AnswerButton("primary-button", T("inform.accept"), "accept"),
					]),
				]);
			}));
		}

		/// <summary>
		/// Redraw the list from the last fetched players.
		/// </summary>
		function Render()
		{
			const introParams = { count: rangeMetres || 5, name: Owls.Store.state.me.name || T("common.you") };
			intro.textContent = config.informConsent ? T("inform.introConsent", introParams) : T("inform.intro", introParams);

			if (!hasLoaded)
			{
				list.replaceChildren(Widgets.EmptyState(T("inform.looking")));
				return;
			}

			if (players.length === 0)
			{
				list.replaceChildren(Widgets.EmptyState(T("inform.nobody")));
				return;
			}

			list.replaceChildren(...players.map((player) =>
			{
				const remaining = GetRemaining(player.playerId);
				const button = Element("button", { className: "secondary-button inform-button", text: remaining > 0 ? T("inform.cooldown", { count: remaining }) : T("inform.title") });
				button.disabled = remaining > 0;
				button.addEventListener("click", () => Send(player, button));

				const row = Element("div", { className: "list-row" },
				[
					Owls.Util.CreateAvatar(player.name || T("inform.stranger"), "", `player-${player.playerId}`, "", Owls.Icons.person),
					Element("span", { className: "row-text" },
					[
						Element("span", { className: "row-title", text: player.name || T("inform.stranger") }),
						Element("span", { className: "row-subtitle", text: T("inform.distance", { distance: player.distance.toLocaleString(Owls.Lang.GetId(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) }),
					]),
					button,
				]);

				return row;
			}));
		}

		/// <summary>
		/// Ask the server who is nearby, then schedule the next refresh.
		/// </summary>
		async function Fetch()
		{
			if (isDestroyed || isFetching)
			{
				return;
			}

			// No point polling while the phone is closed; try again on the next tick.
			if (Owls.App.IsOpen())
			{
				isFetching = true;
				const result = await Owls.Bridge.Request("inform.nearby", {});
				isFetching = false;

				if (isDestroyed)
				{
					return;
				}

				if (result.ok)
				{
					players = result.data.players || [];
					rangeMetres = result.data.rangeMetres || rangeMetres;
					hasLoaded = true;

					// The server's view of the cooldown wins over ours, e.g. after reopening the screen.
					for (const player of players)
					{
						if (player.cooldownSeconds > 0)
						{
							cooldownEnds.set(player.playerId, Date.now() + player.cooldownSeconds * 1000);
						}
					}

					Render();
				}
				else
				{
					SetStatus(result.error, "error");
				}
			}

			refreshTimer = setTimeout(Fetch, refreshMs);
		}

		Render();
		RenderRequests();
		Fetch();

		// Countdowns tick every second between refreshes; finished ones are redrawn once more as "Inform" and then forgotten.
		tickTimer = setInterval(() =>
		{
			if (Owls.Store.state.informRequests.size > 0)
			{
				RenderRequests();
			}

			if (cooldownEnds.size === 0)
			{
				return;
			}

			for (const [playerId, end] of cooldownEnds)
			{
				if (end <= Date.now())
				{
					cooldownEnds.delete(playerId);
				}
			}

			Render();
		}, 1000);

		/// <summary>
		/// Stop polling when the screen goes away.
		/// </summary>
		function Destroy()
		{
			isDestroyed = true;
			clearTimeout(refreshTimer);
			clearInterval(tickTimer);
		}

		/// <summary>
		/// Redraw the waiting owls when one arrives, is answered or the phone re-syncs.
		/// </summary>
		/// <param name="reason">Change reason</param>
		function Refresh(reason)
		{
			if (reason === "informs" || reason === "reset" || reason === "ready")
			{
				RenderRequests();
			}
		}

		return { element, Refresh, Destroy };
	}

	return { Create };
})();
