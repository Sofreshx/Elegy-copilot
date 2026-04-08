'use strict';

function isPrereleaseVersion(version) {
  return /^\d+\.\d+\.\d+-.+/.test(String(version || '').trim());
}

function inferReleaseChannel(version) {
  return isPrereleaseVersion(version) ? 'prerelease' : 'stable';
}

function resolveUpdateChannel({ appVersion, explicitChannel } = {}) {
  const explicit = String(explicitChannel || '').trim().toLowerCase();
  if (!explicit) {
    return {
      ok: true,
      channel: inferReleaseChannel(appVersion),
    };
  }

  if (explicit === 'stable' || explicit === 'prerelease') {
    return {
      ok: true,
      channel: explicit,
    };
  }

  return {
    ok: false,
    channel: 'unknown',
    reason: 'update_channel_invalid',
    explicitChannel: explicit,
  };
}

function resolveDesktopReleaseChannelContract({ appVersion, explicitChannel } = {}) {
  const channelResolution = resolveUpdateChannel({ appVersion, explicitChannel });
  const contract = {
    channel: channelResolution.channel,
    sdkChannel: channelResolution.channel,
    cliChannel: channelResolution.channel,
  };

  if (!channelResolution.ok) {
    return {
      ok: false,
      contract,
      reason: channelResolution.reason,
      explicitChannel: channelResolution.explicitChannel,
    };
  }

  return {
    ok: true,
    contract,
  };
}

module.exports = {
  inferReleaseChannel,
  isPrereleaseVersion,
  resolveDesktopReleaseChannelContract,
  resolveUpdateChannel,
};
