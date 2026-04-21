import { FLOW_FAILED, FLOW_GOOD } from '../spaClient';
import { SpaHomebridgePlatform } from '../platform';

export class MatterThermostatAccessory {
  private readonly matter: any;
  private lastLocalTemperature: number | undefined = undefined;
  private lastOccupiedHeatingSetpoint: number | undefined = undefined;
  private lastUnoccupiedHeatingSetpoint: number | undefined = undefined;
  private lastExternallyMeasuredOccupancy: boolean | undefined = undefined;
  private lastSystemMode: number | undefined = undefined;
  private lastRunningMode: number | undefined = undefined;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
  ) {
    this.matter = (this.platform.api as any).matter;

    if (!this.accessory.clusters) {
      this.accessory.clusters = {};
    }
    if (!this.accessory.clusters.thermostat) {
      this.accessory.clusters.thermostat = {
        localTemperature: 2000,
        occupiedHeatingSetpoint: 3200,
        unoccupiedHeatingSetpoint: 3000,
        externallyMeasuredOccupancy: true,
        absMinHeatSetpointLimit: 700,
        absMaxHeatSetpointLimit: 4000,
        minHeatSetpointLimit: 1000,
        maxHeatSetpointLimit: 4000,
        systemMode: this.getSystemModeHeat(),
        controlSequenceOfOperation: this.getControlSequenceHeatingOnly(),
      };
    }

    this.accessory.handlers = {
      thermostat: {
        setOccupiedHeatingSetpoint: async (request: any) => {
          await this.setTargetTemperatureFromSetpoint(request?.occupiedHeatingSetpoint);
        },
        setSystemMode: async (request: any) => {
          await this.setSystemMode(request?.systemMode);
        },
      },
    };
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
    const unoccupiedHeatingSetpoint = this.getUnoccupiedHeatingSetpoint();
    if (localTemperature === undefined || occupiedHeatingSetpoint === undefined || unoccupiedHeatingSetpoint === undefined) {
      return;
    }
    const externallyMeasuredOccupancy = this.getExternallyMeasuredOccupancy();

    const systemMode = this.getCurrentSystemMode();
    const runningMode = this.platform.spa!.getIsHeatingNow() ? this.getRunningModeHeat() : this.getRunningModeOff();

    if (this.lastLocalTemperature !== localTemperature
      || this.lastOccupiedHeatingSetpoint !== occupiedHeatingSetpoint
      || this.lastUnoccupiedHeatingSetpoint !== unoccupiedHeatingSetpoint
      || this.lastExternallyMeasuredOccupancy !== externallyMeasuredOccupancy
      || this.lastSystemMode !== systemMode
      || this.lastRunningMode !== runningMode) {
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.Thermostat, {
        localTemperature,
        occupiedHeatingSetpoint,
        unoccupiedHeatingSetpoint,
        externallyMeasuredOccupancy,
        systemMode,
        thermostatRunningMode: runningMode,
      });
      this.lastLocalTemperature = localTemperature;
      this.lastOccupiedHeatingSetpoint = occupiedHeatingSetpoint;
      this.lastUnoccupiedHeatingSetpoint = unoccupiedHeatingSetpoint;
      this.lastExternallyMeasuredOccupancy = externallyMeasuredOccupancy;
      this.lastSystemMode = systemMode;
      this.lastRunningMode = runningMode;
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
    const target = this.platform.spa!.getTargetTempHigh();
    if (target === undefined) {
      return undefined;
    }
    const targetC = this.platform.spa!.convertTempToC(target);
    if (targetC === undefined) {
      return undefined;
    }
    const targetCenti = Math.round(targetC * 100);
    return Math.max(2650, Math.min(4000, targetCenti));
  }

  private getUnoccupiedHeatingSetpoint() {
    const target = this.platform.spa!.getTargetTempLow();
    if (target === undefined) {
      return undefined;
    }
    const targetC = this.platform.spa!.convertTempToC(target);
    if (targetC === undefined) {
      return undefined;
    }
    const targetCenti = Math.round(targetC * 100);
    return Math.max(1000, Math.min(3600, targetCenti));
  }

  private getExternallyMeasuredOccupancy() {
    // High temperature range represents normal occupied use; low range is vacation/away.
    return this.platform.spa!.getTempRangeIsHigh();
  }

  private getCurrentSystemMode() {
    const flowState = this.platform.spa!.getFlowState();
    if (flowState === FLOW_FAILED) {
      return this.getSystemModeOff();
    }
    return this.getSystemModeHeat();
  }

  private async setSystemMode(mode: number) {
    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }

    const flowState = this.platform.spa!.getFlowState();
    if (mode === this.getSystemModeOff()) {
      if (flowState === FLOW_GOOD) {
        throw new Error("Spa doesn't allow turning heating off while flow is good. Reverting.");
      }
      return;
    }

    if (mode !== this.getSystemModeHeat()) {
      throw new Error('Spa thermostat supports Heat mode only (plus Off during flow faults).');
    }

    if (flowState !== FLOW_GOOD) {
      throw new Error('Water flow is low or has failed. Heating off');
    }

    this.platform.log.debug('Matter set Thermostat mode -> Heat');
  }

  private async setTargetTemperatureFromSetpoint(setpoint: number | undefined) {
    if (setpoint === undefined) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }

    let tempC = setpoint / 100.0;
    if (tempC > 40.0) {
      tempC = 40.0;
    }
    if (this.platform.spa!.getTempRangeIsHigh()) {
      if (tempC < 26.5) {
        tempC = 26.5;
      }
    } else if (tempC > 36.0) {
      tempC = 36.0;
    }

    const converted = this.platform.spa!.convertTempFromC(tempC);
    if (converted === undefined) {
      return;
    }

    this.platform.spa!.setTargetTemperature(converted);
    this.platform.log.debug('Matter set Thermostat target temperature ->', tempC, 'C');
  }

  private getSystemModeOff() {
    return this.matter.types.Thermostat?.SystemMode?.Off ?? 0;
  }

  private getSystemModeHeat() {
    return this.matter.types.Thermostat?.SystemMode?.Heat ?? 4;
  }

  private getRunningModeOff() {
    return this.matter.types.Thermostat?.RunningMode?.Off ?? 0;
  }

  private getRunningModeHeat() {
    return this.matter.types.Thermostat?.RunningMode?.Heat ?? 4;
  }

  private getControlSequenceHeatingOnly() {
    return this.matter.types.Thermostat?.ControlSequenceOfOperation?.HeatingOnly ?? 4;
  }
}
