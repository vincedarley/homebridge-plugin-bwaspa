import { SpaHomebridgePlatform } from './platform';

export class MatterLockAccessory {
  private readonly matter: any;
  private lastLocked: boolean | undefined = undefined;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
    private readonly entireSpa: boolean,
  ) {
    this.matter = (this.platform.api as any).matter;

    if (!this.accessory.clusters) {
      this.accessory.clusters = {};
    }
    if (!this.accessory.clusters.doorLock) {
      this.accessory.clusters.doorLock = {
        lockState: this.matter.types.DoorLock.LockState.Unlocked,
        lockType: this.matter.types.DoorLock.LockType.Other,
        actuatorEnabled: true,
      };
    }

    this.accessory.handlers = {
      doorLock: {
        lockDoor: async () => this.setLocked(true),
        unlockDoor: async () => this.setLocked(false),
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

    const isLocked = this.platform.spa!.getIsLocked(this.entireSpa);
    if (this.lastLocked !== isLocked) {
      const lockState = isLocked
        ? this.matter.types.DoorLock.LockState.Locked
        : this.matter.types.DoorLock.LockState.Unlocked;
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.DoorLock, {
        lockState,
      });
      this.lastLocked = isLocked;
    }
  }

  private async setLocked(value: boolean) {
    if (!this.platform.isCurrentlyConnected()) {
      this.platform.recordAction(this.setLocked.bind(this, value));
      throw this.platform.connectionProblem;
    }
    this.platform.spa!.setIsLocked(this.entireSpa, value);
    this.platform.log.debug('Matter set Locked Spa', this.entireSpa ? 'Panel' : 'Settings', '->', value);
  }
}