import { SpaClient } from './spaClient';
import { SpaHomebridgePlatform } from './platform';

export class MatterBlowerAccessory {
  private readonly matter: any;
  private numSpeedSettings = 0;
  private scheduleId: any = undefined;
  private lastOn: boolean | undefined = undefined;
  private lastLevel: number | undefined = undefined;

  private lastNonZeroSpeed = 1;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
  ) {
    this.matter = (this.platform.api as any).matter;

    if (!this.accessory.clusters) {
      this.accessory.clusters = {};
    }
    if (!this.accessory.clusters.onOff) {
      this.accessory.clusters.onOff = { onOff: false };
    }
    if (!this.accessory.clusters.levelControl) {
      this.accessory.clusters.levelControl = {
        currentLevel: 0,
        minLevel: 0,
        maxLevel: 255,
      };
    }

    this.accessory.handlers = {
      onOff: {
        on: async () => this.setOn(true),
        off: async () => this.setOn(false),
      },
      levelControl: {
        moveToLevelWithOnOff: async (request: any) => {
          const level = Math.max(0, Math.min(255, request?.level ?? 0));
          const percent = this.levelToSetpointPercent(level);
          await this.setSpeedPercent(percent);
        },
      },
    };
  }

  spaConfigurationKnown() {
    if (this.platform.spa!.getBlowerSpeed() === undefined) {
      this.platform.log.warn('Nonexistent matter blower accessory declared.');
      return;
    }

    this.numSpeedSettings = this.platform.spa!.getBlowerSpeedRange();
    this.platform.log.info('Blower matter accessory has', this.numSpeedSettings, 'speeds.');
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
    const speedValue = this.toLevelValue(speed);

    if (this.lastOn !== isOn) {
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.OnOff, { onOff: isOn });
      this.lastOn = isOn;
    }

    if (this.lastLevel !== speedValue) {
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.LevelControl, { currentLevel: speedValue });
      this.lastLevel = speedValue;
    }
  }

  private async setOn(value: boolean) {
    this.platform.log.debug('Matter set Blower ->', value ? 'On' : 'Off', this.platform.status());

    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }

    if (value) {
      this.scheduleSetSpeed(this.lastNonZeroSpeed);
    } else {
      this.scheduleSetSpeed(0);
    }
  }

  private async setSpeedPercent(percent: number) {
    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }

    const maxSpeed = this.numSpeedSettings > 0 ? this.numSpeedSettings : this.platform.spa!.getBlowerSpeedRange();
    const speed = Math.max(0, Math.min(maxSpeed, Math.round((percent * maxSpeed) / 100.0)));

    this.lastNonZeroSpeed = speed > 0 ? speed : this.lastNonZeroSpeed;

    this.platform.log.debug('Matter set Blower Speed ->', percent, 'which is',
      SpaClient.getSpeedAsString(maxSpeed, speed), this.platform.status());

    this.scheduleSetSpeed(speed);
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

  private toLevelValue(speed: number) {
    if (this.numSpeedSettings <= 0) {
      return speed === 0 ? 0 : 255;
    }
    if (speed === 0) {
      return 0;
    }
    const percent = (100.0 * speed) / this.numSpeedSettings;
    return this.setpointPercentToLevel(percent);
  }

  private levelToSetpointPercent(level: number) {
    if (level <= 0) {
      return 0;
    }
    if (level <= 200) {
      return level / 2.0;
    }
    return 100;
  }

  private setpointPercentToLevel(percent: number) {
    if (percent <= 0) {
      return 0;
    }
    if (percent >= 100) {
      return 255;
    }

    return Math.max(1, Math.min(200, Math.round(percent * 2.0)));
  }
}
