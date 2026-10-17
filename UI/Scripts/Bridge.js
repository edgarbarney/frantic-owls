// FranticDreamer 2026
"use strict";

window.Owls = window.Owls || {};

// ========================
// Bridge
// ========================

/// <summary>
/// The page's only link to the client script (and through it, the server).
///
/// <para>
/// NOTE: Requests resolve with a result object and never reject, matching the server's no-throw results.
/// A request with no reply within the configured timeout resolves as a failure, so the UI can show "not sent" and offer a retry
/// instead of spinning forever on a dropped packet. The timeout comes from network.requestTimeoutMs on the server.
/// </para>
///
/// </summary>
Owls.Bridge = (() =>
{
	const defaultTimeoutMs = 8000;

	/// <summary>
	/// Requests waiting on a reply, by request ID: { resolve, timer }.
	/// </summary>
	const pending = new Map();

	/// <summary>
	/// Item handlers by item type.
	/// </summary>
	const handlers = new Map();

	let requestCounter = 0;
	let timeoutMs = defaultTimeoutMs;

	/// <summary>
	/// Send one event to the client script.
	/// </summary>
	/// <param name="name">Event name</param>
	/// <param name="payload">JSON-serialisable payload, or null</param>
	function Send(name, payload)
	{
		if (typeof window.callEvent !== "function")
		{
			console.warn(`Bridge: callEvent is unavailable; "${name}" was not sent.`);
			return;
		}

		window.callEvent(name, payload === null || payload === undefined ? null : JSON.stringify(payload));
	}

	/// <summary>
	/// Hand one item to every handler registered for its type.
	/// </summary>
	/// <param name="type">Item type</param>
	/// <param name="data">Item payload</param>
	function Dispatch(type, data)
	{
		for (const handler of handlers.get(type) || [])
		{
			handler(data || {});
		}
	}

	/// <summary>
	/// Settle a pending request with the server's reply.
	/// </summary>
	/// <param name="response">{ requestId, ok, error, errorKey, errorParams, data }</param>
	function Resolve(response)
	{
		const request = pending.get(String(response.requestId));

		if (!request)
		{
			return;
		}

		pending.delete(String(response.requestId));
		clearTimeout(request.timer);
		// The server names its error by key so the player reads it in their own language; error is its fallback text.
		const error = response.errorKey ? Owls.Lang.T(String(response.errorKey), response.errorParams || {}) : String(response.error || "");
		request.resolve({ ok: !!response.ok, error, errorKey: String(response.errorKey || ""), data: response.data || {} });
	}

	/// <summary>
	/// Unpack one batch of items from the client script.
	/// </summary>
	/// <param name="items">[{ type, data }]</param>
	function ReceiveItems(items)
	{
		for (const item of Array.isArray(items) ? items : [])
		{
			if (!item || typeof item.type !== "string")
			{
				continue;
			}

			if (item.type === "response")
			{
				Resolve(item.data || {});
			}
			else
			{
				Dispatch(item.type, item.data);
			}
		}
	}

	/// <summary>
	/// Ask the server to do something.
	/// </summary>
	/// <param name="action">Action name (e.g. "messages.send")</param>
	/// <param name="data">Action payload</param>
	/// <returns>Promise of { ok, error, errorKey, data, timedOut } where errorKey names the server's error, for pages that react to one in particular</returns>
	function Request(action, data = {})
	{
		requestCounter += 1;
		const requestId = `r${requestCounter}`;

		return new Promise((resolve) =>
		{
			const timer = setTimeout(() =>
			{
				pending.delete(requestId);
				resolve({ ok: false, error: Owls.Lang.T("error.lost"), errorKey: "error.lost", data: {}, timedOut: true });
			}, timeoutMs);

			pending.set(requestId, { resolve, timer });
			Send("frantic-owls:request", { requestId, action, data });
		});
	}

	/// <summary>
	/// Listen for one item type pushed by the server, or one of the page lifecycle types ("ui:opened", "ui:closed", "ui:layout").
	/// </summary>
	/// <param name="type">Item type</param>
	/// <param name="handler">Function receiving the item's data</param>
	function On(type, handler)
	{
		if (!handlers.has(type))
		{
			handlers.set(type, []);
		}

		handlers.get(type).push(handler);
	}

	/// <summary>
	/// Change how long a request may go unanswered.
	/// </summary>
	/// <param name="milliseconds">New timeout</param>
	function SetTimeout(milliseconds)
	{
		timeoutMs = Number(milliseconds) > 0 ? Number(milliseconds) : defaultTimeoutMs;
	}

	window.addEventListener("frantic-owls:items", (event) => ReceiveItems(event.detail && event.detail.items));
	window.addEventListener("frantic-owls:opened", () => Dispatch("ui:opened", {}));
	window.addEventListener("frantic-owls:closed", () => Dispatch("ui:closed", {}));
	window.addEventListener("frantic-owls:layout", (event) => Dispatch("ui:layout", event.detail));

	return { Send, Request, On, SetTimeout, ReceiveItems };
})();
