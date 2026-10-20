'use strict';
/**
 * Optional GitHub Copilot usage shortcut. Off by default: not everyone has a licence, and then Bazinga says nothing about it.
 * No token and no API: Bazinga only knows where GitHub shows the numbers. (Copilot has no number a program like this can read
 * without asking you for a billing-access token, and that endpoint is not verified here, so we do not guess.)
 */
const USAGE_URL = 'https://github.com/settings/billing';
const ANALYTICS_URL = 'https://github.com/settings/billing/premium_requests_usage';

const settings = (c) => ({ enabled: !!(c && c.enabled === true) });

const WHERE = 'In your editor, click the Copilot icon (VS Code: status bar; JetBrains: status bar, then “View quota usage”; Visual Studio: top right, “Copilot Consumptions”). On GitHub: Settings → Billing → Metered usage → Copilot.';

module.exports = { USAGE_URL, ANALYTICS_URL, WHERE, settings };
