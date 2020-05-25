# Change Log

All notable changes to this project will be documented in this file.

## 1.9.13 (25.05.2020)
- Fixes to pump speed setting problem introduced in 1.9.10
- Better connection dropping handling, hopefully.

## 1.9.10 (25.05.2020)
- When connection to Spa drops for a while, signal an error state to Homekit so that the
  user is aware, and their actions of course take no effect.
- Improved logging to align with the above change
  
## 1.9.9 (24.05.2020)
- Minor code and documentation improvements
- Improved logging for the fault reporting.
- Deal with pump on/speed setting simultaneity to deal with some conditions
  where synchronisation can fail.
- Similarly, allow some synchronisation leeway when we believe the physical
  state has changed outside of Homekit.
- Fix to settings pumps directly from High to Low (a coding error instead set
  the pump to off in this situation).

## 1.9.8 (22.05.2020)
- Some improvements to the fault reporting, with better messages in the log
- Improved documentation

## 1.9.7 (22.05.2020)
- First version that will monitor manual spa state/control changes and tell HomeKit about them.
- This means 'digital' and 'manual' state of all the Spa controls should be fully in sync.

## 1.9.6 (21.05.2020)
- When Spa temperature is unknown/undefined (during priming), report 'null' to Homekit which seems to be ignored by Homekit, which just reports the previously known value = better user experience.
- Beginnings of infrastructure to have Homekit update to be in sync when manual spa controls are used

## 1.9.5 (20.05.2020)
- Only read the Spa control types configuration once, rather than each time a socket error/reconnection happens
- Use 'info' logging for socket error+reconnection for greater visibility of potential problems

## 1.9.4 (19.05.2020)
- Some interpretation of the additional control panel requests (e.g. to get the motherboard model)
- Some code cleanup
- Only use same-day spa faults to trigger the water flow sensor state (previously also day before used)

## 1.9.3 (19.05.2020)
- Clean up to some spa messages, and added control panel requests 1-4 to gain more information

## 1.9.2 (19.05.2020)
- Code cleanup and documentation
- Verified By Homebridge
- Changed some defaults to placeholders in the config schema
- Added link to readme so that you can report/validate your spa configuration for automatic setup

## 1.9.1 (18.05.2020)
- Use of automatic Spa configuration to constrain lights
- Improved handling of intervals to check on Spa faults

## 1.9.0 (18.05.2020)
- Cleanup of Spa socket connection code for more robustness and recovery from error conditions
- Fix (untested) to pumps 5 and 6
- Use of automatic Spa configuration to constrain what messages can be sent and what accessories can be used.

## 1.8.4 (17.05.2020)
- Fix for lights, now we support one or two lights

## 1.8.2 (17.05.2020)
- Fix for single-speed pumps

## 1.8.1 (17.05.2020)
- Updated README
- Check for spa faults every 10 minutes
- Refactor code that reads Spa configuration automatically and ensure it is called at
  the earliest sensible time.

## 1.8.0 (17.05.2020)
- Read pumps (and their number of speeds), and lights, etc from the Spa automatically
- Use Pump speed determination for better logic on setting speeds (which was probably
  slightly broken for 1 speed pumps in the previous versions)

## 1.7.1 (16.05.2020)
- Beginnings of automatically determining number of pumps

## 1.7.0 (16.05.2020)
- Added support for 2 lights and 6 pumps (needs testing, since my spa has 1 light, 3 pumps...). If you used a prior version, even with just 1 light, your config will need updating.
- Some code and logging to aim towards automatic configuration

## Previous releases no changelog available



