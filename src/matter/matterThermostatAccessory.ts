import { FLOW_FAILED, FLOW_GOOD } from '../spaClient';
import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';
import type { SpaHomebridgePlatform } from '../platform';

/*
 * The Spa's heating control works in a very specific way. First there is a primary mode "High" which we will refer to as "Heat" or the
 * primary thermostat. This allows a temperature range of 26.5C-40C (80F-104F) which is the normal operating range for the spa when in use. 
 * Then there is a secondary mode "Low" which we will refer to as "Eco Mode" or the secondary thermostat. This allows a 
 * temperature range of 10C-36C (50F-96F) which is intended for when the spa is not in use and you want to maintain a lower temperature 
 * to save energy while still preventing freezing and allowing faster heating when you want to use it again. 
 * The user can switch between these two modes by changing the "temperature range" setting on the spa (Low/High). 
 * A final detail is that when the water flow has failed or is slow, the thermostat turns off.
 * 
 * The question is how best to represent this in Matter in a user-friendly fashion. 
 * 
 * The approach we use is as follows:
 * - We have two Matter thermostats: a "primary" one and an "eco" one. Each can be in "Heat" or "Off" mode.
 * - Setting one to Heat automatically switches the spa mode, causing the other thermostat to show Off on the next update.
 * - The primary thermostat controls the high temperature range (26.5-40°C) and is active when spa is in high mode.
 * - The eco thermostat controls the low temperature range (10-36°C) and is active when spa is in low mode.
 * - Separately, we provide an "Eco Mode" switch as a convenience to toggle between the two modes.
 * - The user can choose which accessories to expose in their Matter UI.
 * 
 * Implementation: This class is instantiated twice with different 'mode' parameters ('primary' or 'eco').
 * The mode determines which spa temperature range this thermostat controls and when it shows as active.
 * 
 * Note that we previously considered an approach with a single thermostat with "occupancy" status, but this didn't
 * provide a nice UI, and seemed less supported by Homebridge-Matter.  
 * 
 * A final option worth considering for Matter is a "Water Heater" device type. While this is
 * not designed for Spas, it does have some semantic overlap (e.g. the schedule you want to set up for hot water for
 * showers). Worth investigating at some point, especially if the Home UI for a water heater is nice (reading Apple's
 * developer documentation it looks well supported). However WaterHeater seems not to be in Homebridge-Matter yet.
 */
export class MatterThermostatAccessory extends BaseMatterSpaAccessory {
  private readonly mode: 'primary' | 'eco';
  private readonly systemModeOff: number;
  private readonly systemModeHeat: number;
  private readonly controlSequenceHeatingOnly: number;

  private lastLocalTemperature: number | undefined = undefined;
  private lastOccupiedHeatingSetpoint: number | undefined = undefined;
  private lastSystemMode: number | undefined = undefined;

  constructor(
    platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
    mode: 'primary' | 'eco',
  ) {
    const matter = (platform.api as any).matter;
    const systemModeOff = matter.types.Thermostat?.SystemMode?.Off;
    const systemModeHeat = matter.types.Thermostat?.SystemMode?.Heat;
    const controlSequenceHeatingOnly = matter.types.Thermostat?.ControlSequenceOfOperation?.HeatingOnly;
    if (systemModeOff === undefined || systemModeHeat === undefined || controlSequenceHeatingOnly === undefined) {
      throw new Error('Matter Thermostat enums are unavailable: Off/Heat/SystemSequence HeatingOnly are required.');
    }

    // Create thermostat with Heating feature only
    // - Heating: core functionality for spa heating control
    // - NO Occupancy: using two separate thermostat instances instead
    // - NO AutoMode: no deadband constraint between heating/cooling setpoints
    // - NO Cooling: heating-only spa behavior (spa cannot cool, only heat)
    // - NO Presets: we don't use preset schedules
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
    
    // WORKAROUND: Homebridge bug - it reads behavior.cluster.supportedFeatures instead of behavior.features
    // We need to set cluster.supportedFeatures so Homebridge can detect our custom features.  The homebridge-matter
    // sample Thermostat accessory code is very simple and just uses defaults. Unfortunately therefore it doesn't
    // help us understanding how to correctly code a thermostat with particular configured features.
    // For that we need to look at homebridge and/or matter source code and documentation.
    // This code below solves or works around the problem of having thermostat with Off/Heat states only.
    // But it still leads to Presets issues.  We need to diagnose those further.
    const behaviorsStructure = (matterDeviceType as any)?.behaviors;
    if (behaviorsStructure) {
      const behaviorsArray = Array.isArray(behaviorsStructure) 
        ? behaviorsStructure 
        : Object.values(behaviorsStructure);
      const thermostatBehavior = behaviorsArray.find((b: any) => 
        b?.cluster?.id === 0x201 || b?.id === 'thermostat',
      );
      
      if (thermostatBehavior && thermostatBehavior.cluster && thermostatBehavior.features) {
        thermostatBehavior.cluster.supportedFeatures = thermostatBehavior.features;
        platform.log.info('[Matter Thermostat] Set cluster.supportedFeatures for Homebridge detection:', 
          JSON.stringify(thermostatBehavior.features));
      }
    }
    
    // Set temperature limits based on mode
    // Primary (high range): 26.5-40°C = 2650-4000 (in hundredths)
    // Eco (low range): 10-36°C = 1000-3600 (in hundredths)
    const minLimit = mode === 'primary' ? 2650 : 1000;
    const maxLimit = mode === 'primary' ? 4000 : 3600;
    const initialSetpoint = mode === 'primary' ? 3850 : 3000;
    
    super(
      platform,
      device,
      matterDeviceType,
      {
        thermostat: {
          localTemperature: 2000,
          occupiedHeatingSetpoint: initialSetpoint,
          absMinHeatSetpointLimit: 700,
          absMaxHeatSetpointLimit: 4000,
          minHeatSetpointLimit: minLimit,
          maxHeatSetpointLimit: maxLimit,
          systemMode: systemModeHeat,
          controlSequenceOfOperation: controlSequenceHeatingOnly,
        },
      },
      {
        thermostat: {
          occupiedHeatingSetpointChange: async (request: any) => {
            await this.setTargetTemperatureFromSetpoint(request?.occupiedHeatingSetpoint);
          },
          systemModeChange: async (request: any) => {
            await this.setSystemMode(request?.systemMode);
          },
        },
      },
    );
    
    this.mode = mode;
    this.systemModeOff = systemModeOff;
    this.systemModeHeat = systemModeHeat;
    this.controlSequenceHeatingOnly = controlSequenceHeatingOnly;
  }

  spaConfigurationKnown() {
    // nothing to do
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }

    const localTemperature = this.getLocalTemperature();
    const occupiedHeatingSetpoint = this.getOccupiedHeatingSetpoint();
    if (localTemperature === undefined || occupiedHeatingSetpoint === undefined) {
      return;
    }

    const systemMode = this.getCurrentSystemMode();

    if (this.lastLocalTemperature !== localTemperature
      || this.lastOccupiedHeatingSetpoint !== occupiedHeatingSetpoint
      || this.lastSystemMode !== systemMode) {
      const payload = {
        localTemperature,
        occupiedHeatingSetpoint,
        controlSequenceOfOperation: this.getControlSequenceHeatingOnly(),
        systemMode,
      };

      this.platform.log.info('[Matter Thermostat] update payload', this.UUID, JSON.stringify(payload));
      try {
        const beforeState = await this.readState('thermostat');
        this.platform.log.info('[Matter Thermostat] current thermostat state before update', this.UUID, JSON.stringify(beforeState ?? {}));
      } catch (stateReadError) {
        this.platform.log.error('[Matter Thermostat] could not read thermostat state before update for', this.UUID, stateReadError);
      }

      try {
        await this.updateState('thermostat', payload);
      } catch (error) {
        this.platform.log.error('[Matter Thermostat] update failed for', this.UUID, 'payload:', JSON.stringify(payload));
        try {
          const currentState = await this.readState('thermostat');
          this.platform.log.error('[Matter Thermostat] current thermostat state after failed update',
            this.UUID, JSON.stringify(currentState ?? {}));
        } catch (stateReadError) {
          this.platform.log.error('[Matter Thermostat] could not read thermostat state after failed update for',
            this.UUID, stateReadError);
        }
        throw error;
      }

      this.lastLocalTemperature = localTemperature;
      this.lastOccupiedHeatingSetpoint = occupiedHeatingSetpoint;
      this.lastSystemMode = systemMode;
    }
  }

  private getLocalTemperature() {
    const current = this.platform.spa!.getCurrentTemp();
    if (current === undefined) {
      return undefined;
    }
    const currentC = this.platform.spa!.convertTempToC(current);
    if (currentC === undefined) {
      return undefined;
    }
    return Math.round(currentC * 100);
  }

  private getOccupiedHeatingSetpoint() {
    // Route to correct spa temperature range based on mode
    const target = this.mode === 'primary' 
      ? this.platform.spa!.getTargetTempHigh()
      : this.platform.spa!.getTargetTempLow();
    
    if (target === undefined) {
      return undefined;
    }
    const targetC = this.platform.spa!.convertTempToC(target);
    if (targetC === undefined) {
      return undefined;
    }
    const targetCenti = Math.round(targetC * 100);
    
    // Apply limits based on mode
    if (this.mode === 'primary') {
      return Math.max(2650, Math.min(4000, targetCenti)); // 26.5-40°C
    } else {
      return Math.max(1000, Math.min(3600, targetCenti)); // 10-36°C
    }
  }

  private getCurrentSystemMode() {
    const flowState = this.platform.spa!.getFlowState();
    if (flowState === FLOW_FAILED) {
      return this.getSystemModeOff();
    }
    
    // Determine if this thermostat should be active based on mode
    const isSpaInHighRange = this.platform.spa!.getTempRangeIsHigh();
    const isThisThermostatActive = this.mode === 'primary' ? isSpaInHighRange : !isSpaInHighRange;
    
    return isThisThermostatActive ? this.getSystemModeHeat() : this.getSystemModeOff();
  }

  private async setSystemMode(mode: number) {
    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }

    const flowState = this.platform.spa!.getFlowState();
    
    if (mode === this.getSystemModeOff()) {
      // Check if we're trying to turn off the currently active thermostat
      const isSpaInHighRange = this.platform.spa!.getTempRangeIsHigh();
      const isThisThermostatActive = this.mode === 'primary' ? isSpaInHighRange : !isSpaInHighRange;
      
      if (flowState === FLOW_GOOD && isThisThermostatActive) {
        // Turn off this thermostat by switching to the other one
        // Primary Off → switch to eco (low range), Eco Off → switch to primary (high range)
        const shouldBeHighRange = this.mode === 'eco';
        this.platform.spa!.setTempRangeIsHigh(shouldBeHighRange);
        this.platform.log.debug(`Matter turned off ${this.mode} Thermostat -> switching to ${shouldBeHighRange ? 'primary' : 'eco'}`);
        return;
      }
      // If this thermostat is already off, do nothing
      return;
    }

    if (mode !== this.getSystemModeHeat()) {
      throw new Error('Spa thermostat supports Heat and Off modes only.');
    }

    if (flowState !== FLOW_GOOD) {
      throw new Error('Water flow is low or has failed. Heating off');
    }

    // Setting to Heat: switch spa to this thermostat's mode
    // This will cause the other thermostat to show Off on next update
    const shouldBeHighRange = this.mode === 'primary';
    this.platform.spa!.setTempRangeIsHigh(shouldBeHighRange);
    this.platform.log.debug(`Matter set ${this.mode} Thermostat mode -> Heat (spa range: ${shouldBeHighRange ? 'high' : 'low'})`);
  }

  private async setTargetTemperatureFromSetpoint(setpoint: number | undefined) {
    if (setpoint === undefined) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }

    let tempC = setpoint / 100.0;
    
    // Apply range constraints based on mode
    if (this.mode === 'primary') {
      // High range (occupied): 26.5-40°C
      if (tempC < 26.5) {
        tempC = 26.5;
      }
      if (tempC > 40.0) {
        tempC = 40.0;
      }
    } else {
      // Low range (eco): 10-36°C
      if (tempC < 10.0) {
        tempC = 10.0;
      }
      if (tempC > 36.0) {
        tempC = 36.0;
      }
    }

    const converted = this.platform.spa!.convertTempFromC(tempC);
    if (converted === undefined) {
      return;
    }

    this.platform.spa!.setTargetTemperature(converted);
    this.platform.log.debug(`Matter set ${this.mode} Thermostat target temperature ->`, tempC, 'C');
  }

  private getSystemModeOff() {
    return this.systemModeOff;
  }

  private getSystemModeHeat() {
    return this.systemModeHeat;
  }

  private getControlSequenceHeatingOnly() {
    return this.controlSequenceHeatingOnly;
  }
}
