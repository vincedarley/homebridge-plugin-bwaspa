import type { Logger } from 'homebridge';

export function createHeatingOnlyThermostatDeviceType(matter: any, log: Logger) {
  const thermostatType = matter.deviceTypes.Thermostat;
  if (typeof thermostatType?.with !== 'function') {
    throw new Error('Matter Thermostat device type does not support .with().');
  }

  const thermostatRequirement = thermostatType?.requirements?.Thermostat
    ?? thermostatType?.requirements?.ThermostatServer;
  if (typeof thermostatRequirement?.with !== 'function') {
    throw new Error('Matter Thermostat requirement does not support .with(Heating).');
  }

  const matterDeviceType = thermostatType.with(thermostatRequirement.with('Heating'));
  applyHeatingOnlyNoPresetFeatures(matterDeviceType, log);
  return matterDeviceType;
}

function applyHeatingOnlyNoPresetFeatures(matterDeviceType: any, log: Logger) {
  const features = {
    heating: true,
    cooling: false,
    occupancy: false,
    autoMode: false,
    presets: false,
    scheduleConfiguration: false,
    setback: false,
    matterScheduleConfiguration: false,
    localTemperatureNotExposed: false,
  };

  const behaviorsStructure = matterDeviceType?.behaviors;
  if (!behaviorsStructure) {
    return;
  }

  const behaviorsArray = Array.isArray(behaviorsStructure)
    ? behaviorsStructure
    : Object.values(behaviorsStructure);

  const thermostatBehavior = behaviorsArray.find((b: any) => b?.cluster?.id === 0x201 || b?.id === 'thermostat');
  if (!thermostatBehavior?.cluster) {
    return;
  }

  // Only patch the writable cluster metadata that Homebridge reads.
  // thermostatBehavior.features can be read-only in some runtime builds.
  thermostatBehavior.cluster.supportedFeatures = features;

  log.debug('[Matter Thermostat] Forced supportedFeatures to heating-only without presets:', JSON.stringify(features));
}
