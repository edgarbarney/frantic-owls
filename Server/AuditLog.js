// FranticDreamer 2026
"use strict";

const { Logger } = require("./Logger.js");

/// <summary>
/// Discord limits: embeds per message, and characters per embed description and per field value.
/// </summary>
const maxEmbedsPerPost = 10;
const maxDescriptionLength = 3500;
const maxFieldLength = 1000;

/// <summary>
/// Entries kept while Discord is unreachable or rate limiting. The oldest are dropped first.
/// </summary>
const maxQueuedEntries = 200;

/// <summary>
/// Embed colour per category, so a busy log channel can be scanned by eye.
/// </summary>
const categoryColours = Object.freeze
({
	messages: 0xc9a45c,
	groups: 0x7fb38a,
	informs: 0x6b8fc9,
	calls: 0x5cb8c9,
	blocks: 0xc96a5c,
	announcements: 0x9b59b6,
	system: 0x95a5a6,
});

/// <summary>
/// Webhook hosts accepted for direct posting.
/// </summary>
const discordWebhookPattern = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

// ========================
// Audit Log
// ========================

/// <summary>
/// Optional Discord log of owl activity (logging.enabled).
///
/// <para>
/// NOTE: With logging.includeBodies the log holds the text of private owls, readable by anyone who can see the Discord channel.
/// It is off by default for that reason; tell players if you turn it on.
/// When hmp-webhooks is running and logging.destination names one of its destinations, entries go through it (its queue, pacing and retries).
/// Otherwise they are posted straight to logging.url, or to the URL in the environment variable named by logging.urlEnv,
/// batched every logging.flushIntervalMs and held back while Discord asks us to slow down. A log failure never affects owls.
/// </para>
///
/// </summary>
class AuditLog
{
	/// <summary>
	/// The "logging" section of the server config.
	/// </summary>
	#config;

	/// <summary>
	/// hmp-webhooks import, or null when that resource is not running.
	/// </summary>
	#webhooks = null;

	/// <summary>
	/// Webhook URL for direct posting, or an empty string.
	/// </summary>
	#url = "";

	/// <summary>
	/// Embeds waiting to be posted directly.
	/// </summary>
	#queue = [];

	/// <summary>
	/// Flush timer while running.
	/// </summary>
	#timer = null;

	/// <summary>
	/// Do not post before this time (epoch milliseconds), after a rate limit.
	/// </summary>
	#retryAt = 0;

	/// <summary>
	/// True while a direct post is in progress, so flushes never overlap.
	/// </summary>
	#isPosting = false;

	/// <summary>
	/// Cut text to a length Discord accepts.
	/// </summary>
	/// <param name="text">Any text</param>
	/// <param name="maxLength">Longest allowed length</param>
	/// <returns>Text, shortened with an ellipsis when needed</returns>
	#Truncate(text, maxLength)
	{
		const value = String(text ?? "");
		return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
	}

	/// <summary>
	/// Post queued embeds straight to the webhook.
	/// </summary>
	async #Flush()
	{
		if (this.#isPosting || this.#queue.length === 0 || Date.now() < this.#retryAt)
		{
			return;
		}

		this.#isPosting = true;
		const batch = this.#queue.splice(0, maxEmbedsPerPost);

		// fetch rejects on network failure; that must only cost us this batch, never an owl.
		try
		{
			const response = await fetch(this.#url,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: this.#config.username, embeds: batch, allowed_mentions: { parse: [] } }),
			});

			if (response.status === 429)
			{
				const retryAfter = Number(response.headers.get("retry-after")) || 5;
				this.#retryAt = Date.now() + retryAfter * 1000;
				this.#queue.unshift(...batch);
			}
			else if (!response.ok)
			{
				Logger.LogWarning("AuditLog", `Discord refused a log post (HTTP ${response.status}); ${batch.length} entries dropped.`);
			}
		}
		catch (error)
		{
			Logger.LogWarning("AuditLog", `Could not reach Discord: ${Logger.Describe(error)}`);
			this.#retryAt = Date.now() + 15000;
			this.#queue.unshift(...batch);
		}

		this.#queue.splice(0, Math.max(0, this.#queue.length - maxQueuedEntries));
		this.#isPosting = false;
	}

	/// <summary>
	/// Constructor.
	/// </summary>
	/// <param name="loggingConfig">The "logging" section of the server config</param>
	constructor(loggingConfig)
	{
		this.#config = loggingConfig;
	}

	/// <summary>
	/// Choose how to deliver and start the flush timer.
	/// </summary>
	/// <param name="webhooks">hmp-webhooks import, or null</param>
	/// <returns>True when logging is active</returns>
	Start(webhooks)
	{
		if (!this.#config.enabled)
		{
			return false;
		}

		if (webhooks && this.#config.destination)
		{
			this.#webhooks = webhooks;
			Logger.LogSuccess("AuditLog", `Logging owls to the hmp-webhooks destination "${this.#config.destination}".`);
			return true;
		}

		const url = String(this.#config.url || process.env[this.#config.urlEnv] || "").trim();

		if (!discordWebhookPattern.test(url))
		{
			Logger.LogWarning("AuditLog", `Logging is on, but neither hmp-webhooks nor a Discord webhook URL (logging.url or $${this.#config.urlEnv}) is available. Nothing will be logged.`);
			return false;
		}

		if (typeof fetch !== "function")
		{
			Logger.LogWarning("AuditLog", "This Node.js runtime has no fetch(); direct Discord logging is unavailable. Install hmp-webhooks instead.");
			return false;
		}

		this.#url = url;
		this.#timer = setInterval(() => this.#Flush(), this.#config.flushIntervalMs);
		Logger.LogSuccess("AuditLog", "Logging owls directly to a Discord webhook.");
		return true;
	}

	/// <summary>
	/// Stop the timer, trying once to post what is still queued.
	/// </summary>
	Stop()
	{
		if (this.#timer !== null)
		{
			clearInterval(this.#timer);
			this.#timer = null;
		}

		this.#Flush();
	}

	/// <summary>
	/// Whether owl text may be written to the log.
	/// </summary>
	/// <returns>True when logging.includeBodies is on</returns>
	ShouldIncludeBodies()
	{
		return this.#config.includeBodies === true;
	}

	/// <summary>
	/// Record one event, if logging is on and its category is enabled.
	/// </summary>
	/// <param name="category">"messages", "groups", "informs", "calls", "blocks", "announcements" or "system"</param>
	/// <param name="title">Short headline</param>
	/// <param name="description">One or more lines of detail</param>
	/// <param name="fields">Extra [{ name, value, inline }] (optional)</param>
	Log(category, title, description, fields = [])
	{
		if (!this.#config.enabled || !this.#config.events[category] || (!this.#webhooks && !this.#url))
		{
			return;
		}

		const message =
		{
			title: this.#Truncate(title, 250),
			description: this.#Truncate(description, maxDescriptionLength),
			color: categoryColours[category] || categoryColours.system,
			fields: fields.map((field) => ({ name: this.#Truncate(field.name, 250), value: this.#Truncate(field.value || "​", maxFieldLength), inline: !!field.inline })),
			timestamp: new Date().toISOString(),
		};

		if (this.#webhooks)
		{
			this.#webhooks.send(this.#config.destination, { ...message, footer: "frantic-owls", username: this.#config.username });
			return;
		}

		this.#queue.push(message);

		if (this.#queue.length > maxQueuedEntries)
		{
			this.#queue.shift();
		}
	}
}

module.exports = { AuditLog };
