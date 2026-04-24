import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';
import type { SpaHomebridgePlatform } from '../platform';

export class MatterLockAccessory extends BaseMatterSpaAccessory {
  private readonly entireSpa: boolean;
  private lastLocked: boolean | undefined = undefined;

  constructor(
    platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
    entireSpa: boolean,
  ) {
    const matter = (platform.api as any).matter;
    super(
      platform,
      device,
      matter.deviceTypes.DoorLock,
      {
        doorLock: {
          lockState: matter.types.DoorLock?.LockState?.Unlocked ?? 2,
          lockType: matter.types.DoorLock?.LockType?.DeadBolt ?? 0,
          operatingMode: matter.types.DoorLock?.OperatingMode?.Normal ?? 0,
          actuatorEnabled: true,
        },
      },
      {
        doorLock: {
          lockDoor: async () => this.setLocked(true),
          unlockDoor: async () => this.setLocked(false),
        },
      },
    );
    this.entireSpa = entireSpa;
  }

  spaConfigurationKnown() {
    // Set initial lock state
    void this.updateCharacteristics().catch((error: unknown) => {
      this.platform.log.warn('Could not set initial lock state for', this.displayName, 'because:', error);
    });
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }

    const isLocked = this.platform.spa!.getIsLocked(this.entireSpa);
    if (this.lastLocked !== isLocked) {
      const lockState = isLocked
        ? (this.matter.types.DoorLock?.LockState?.Locked ?? 1)
        : (this.matter.types.DoorLock?.LockState?.Unlocked ?? 2);
      await this.updateState('doorLock', { lockState });
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