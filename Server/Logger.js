// FranticDreamer 2026
"use strict";

// ========================
// Logger
// ========================

/// <summary>
/// Structured logger for the server side of frantic-owls.
/// Every line is prefixed with the emitting component's name so multi-component logs stay attributable.
///
/// <para>
/// NOTE: This wraps the hmp-lib logger when one is supplied, falling back to the console otherwise.
/// The runtime's console already prefixes output with the resource name, so only the component is added here.
/// </para>
///
/// </summary>
class Logger
{
	/// <summary>
	/// Backing hmp-lib logger, or null to write straight to the console.
	/// </summary>
	static #sink = null;

	/// <summary>
	/// Write one prefixed line at the given level.
	/// </summary>
	/// <param name="level">hmp-lib level name ("info", "warn" or "error")</param>
	/// <param name="component">Name of the emitting component</param>
	/// <param name="text">Message to log</param>
	static #Write(level, component, text)
	{
		const line = `${component}: ${text}`;

		if (Logger.#sink)
		{
			Logger.#sink[level](line);
			return;
		}

		switch (level)
		{
		case "warn":
			console.warn(line);
			break;
		case "error":
			console.error(line);
			break;
		default:
			console.log(line);
			break;
		}
	}

	/// <summary>
	/// Route every following log line through an hmp-lib logger.
	/// </summary>
	/// <param name="hmpLogger">Logger created with Hmp.logger.create(), or null for the console</param>
	static Initialise(hmpLogger)
	{
		Logger.#sink = hmpLogger || null;
	}

	/// <summary>
	/// Log an informational line.
	/// </summary>
	/// <param name="component">Name of the emitting component (e.g. "Chats")</param>
	/// <param name="text">Message to log</param>
	static LogMessage(component, text)
	{
		Logger.#Write("info", component, text);
	}

	/// <summary>
	/// Log a warning: something unexpected happened, but the operation could continue.
	/// </summary>
	/// <param name="component">Name of the emitting component</param>
	/// <param name="text">Message to log</param>
	static LogWarning(component, text)
	{
		Logger.#Write("warn", component, text);
	}

	/// <summary>
	/// Log an error: the operation failed and returned a sentinel to its caller.
	/// </summary>
	/// <param name="component">Name of the emitting component</param>
	/// <param name="text">Message to log</param>
	static LogError(component, text)
	{
		Logger.#Write("error", component, text);
	}

	/// <summary>
	/// Log a notable success, such as a finished start-up step.
	/// </summary>
	/// <param name="component">Name of the emitting component</param>
	/// <param name="text">Message to log</param>
	static LogSuccess(component, text)
	{
		Logger.#Write("info", component, `OK: ${text}`);
	}

	/// <summary>
	/// Extract a readable message from anything a rejected promise might carry.
	/// </summary>
	/// <param name="error">Caught value</param>
	/// <returns>Message text, never empty</returns>
	static Describe(error)
	{
		if (error && typeof error === "object" && "message" in error)
		{
			return String(error.message || "Unknown error");
		}

		return String(error || "Unknown error");
	}
}

module.exports = { Logger };
