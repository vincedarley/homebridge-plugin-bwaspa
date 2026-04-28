import { MatterStatus } from 'homebridge';
import { SpaClient } from '../spaClient';
import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';
import type { SpaHomebridgePlatform } from '../platform';

export class MatterBlowerAccessory extends BaseMatterSpaAccessory {
  private numSpeedSettings = 0;
  private scheduleId: any = undefined;
  private lastOn: boolean | undefined = undefined;
  private lastFanMode: number | undefined = undefined;
  private lastPercentSetting: number | undefined = undefined;

  private lastNonZeroSpeed = 1;

  constructor(
    platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
  ) {
    const matter = (platform.api as any).matter;
    super(
      platform,
      device,
      matter.deviceTypes.Fan || matter.deviceTypes.Pump,
      {
        onOff: { onOff: false },
        fanControl: {
          fanMode: (matter.types.FanControl?.FanMode?.Off ?? 0),
          fanModeSequence: (matter.types.FanControl?.FanModeSequence?.OffLowMedHigh ?? 5),
        },
      },
      {
        onOff: {
          on: async () => this.setOn(true),
          off: async () => this.setOn(false),
        },
        fanControl: {
          fanModeChange: async (request: any) => {
            await this.setFanMode(request?.fanMode);
          },
          percentSettingChange: async (request: any) => {
            await this.setPercentSetting(request?.percentSetting);
          },
        },
      },
    );
  }

  spaConfigurationKnown() {
    if (this.platform.spa!.getBlowerSpeed() === undefined) {
      this.platform.log.warn('Nonexistent matter blower accessory declared.');
      return;
    }

    this.numSpeedSettings = this.platform.spa!.getBlowerSpeedRange();
    this.platform.log.info('Blower matter accessory has', this.numSpeedSettings, 'speeds.');
    
    // Set initial state
    void this.updateCharacteristics().catch((error: unknown) => {
      this.platform.log.warn('Could not set initial blower state for', this.displayName, 'because:', error);
    });
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }

    const speed = this.getSpeed();
    if (speed === undefined) {
      return;
    }

    const isOn = speed !== 0;
    const fanMode = this.toFanModeValue(speed);
    const percentSetting = this.toPercentSettingValue(speed);

    if (this.lastOn !== isOn) {
      await this.updateState('onOff', { onOff: isOn });
      this.lastOn = isOn;
    }

    if (this.lastFanMode !== fanMode || this.lastPercentSetting !== percentSetting) {
      await this.updateState('fanControl', {
        fanMode,
        percentSetting,
        percentCurrent: percentSetting,
      });
      this.lastFanMode = fanMode;
      this.lastPercentSetting = percentSetting;
    }
  }

  private async setOn(value: boolean) {
    this.platform.log.debug('Matter set Blower ->', value ? 'On' : 'Off', this.platform.status());

    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    if (value) {
      this.scheduleSetSpeed(this.lastNonZeroSpeed);
    } else {
      this.scheduleSetSpeed(0);
    }
  }

  private async setSpeedPercent(percent: number) {
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    const maxSpeed = this.numSpeedSettings > 0 ? this.numSpeedSettings : this.platform.spa!.getBlowerSpeedRange();
    const speed = Math.max(0, Math.min(maxSpeed, Math.round((percent * maxSpeed) / 100.0)));

    this.lastNonZeroSpeed = speed > 0 ? speed : this.lastNonZeroSpeed;

    this.platform.log.debug('Matter set Blower Speed ->', percent, 'which is',
      SpaClient.getSpeedAsString(maxSpeed, speed), this.platform.status());

    this.scheduleSetSpeed(speed);
  }

  private async setFanMode(mode: number | undefined) {
    if (mode === undefined) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw new MatterStatus.Failure('Spa temporarily offline');
    }

    if (mode === this.getFanModeOff()) {
      this.scheduleSetSpeed(0);
      return;
    }

    if (mode === this.getFanModeLow()) {
      this.scheduleSetSpeed(this.speedForFanMode('low'));
      return;
    }

    if (mode === this.getFanModeMedium()) {
      this.scheduleSetSpeed(this.speedForFanMode('medium'));
      return;
    }

    this.scheduleSetSpeed(this.speedForFanMode('high'));
  }

  private async setPercentSetting(percentSetting: number | null | undefined) {
    if (percentSetting === undefined || percentSetting === null) {
      return;
    }
    await this.setSpeedPercent(Math.max(0, Math.min(100, percentSetting)));
  }

  private scheduleSetSpeed(speed: number) {
    const newSpeed = speed;
    if (this.scheduleId) {
      clearTimeout(this.scheduleId);
      this.scheduleId = undefined;
    }

    this.scheduleId = setTimeout(() => {
      this.setSpeed(newSpeed);
      this.scheduleId = undefined;
    }, 10);
  }

  private setSpeed(speed: number) {
    this.platform.log.debug('Matter Blower actually setting speed to', speed, 'which is',
      SpaClient.getSpeedAsString(this.numSpeedSettings, speed), this.platform.status());
    this.platform.spa!.setBlowerSpeed(speed);
    if (speed !== 0) {
      this.lastNonZeroSpeed = speed;
    }
  }

  private getSpeed() {
    return this.platform.spa!.getBlowerSpeed();
  }

  private toFanModeValue(speed: number) {
    if (speed <= 0) {
      return this.getFanModeOff();
    }
    if (this.numSpeedSettings <= 1) {
      return this.getFanModeHigh();
    }
    if (this.numSpeedSettings === 2) {
      return speed >= 2 ? this.getFanModeHigh() : this.getFanModeLow();
    }
    if (speed >= this.numSpeedSettings) {
      return this.getFanModeHigh();
    }
    if (speed >= 2) {
      return this.getFanModeMedium();
    }
    return this.getFanModeLow();
  }

  private toPercentSettingValue(speed: number) {
    if (speed <= 0 || this.numSpeedSettings <= 0) {
      return 0;
    }
    return Math.max(1, Math.min(100, Math.round((100.0 * speed) / this.numSpeedSettings)));
  }

  private speedForFanMode(mode: 'low' | 'medium' | 'high') {
    const maxSpeed = this.numSpeedSettings > 0 ? this.numSpeedSettings : this.platform.spa!.getBlowerSpeedRange();
    if (maxSpeed <= 1) {
      return mode === 'high' ? 1 : 0;
    }
    if (mode === 'high') {
      return maxSpeed;
    }
    if (mode === 'medium') {
      return Math.max(1, Math.min(maxSpeed, Math.round((maxSpeed + 1) / 2)));
    }
    return 1;
  }

  private getFanModeOff() {
    return this.matter.types.FanControl?.FanMode?.Off ?? 0;
  }

  private getFanModeLow() {
    return this.matter.types.FanControl?.FanMode?.Low ?? 1;
  }

  private getFanModeMedium() {
    return this.matter.types.FanControl?.FanMode?.Medium ?? 2;
  }

  private getFanModeHigh() {
    return this.matter.types.FanControl?.FanMode?.High ?? 3;
  }
}
