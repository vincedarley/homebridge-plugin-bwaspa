# Change Log

All notable changes to this project will be documented in this file.

## 1.8.3 (17.05.2020)
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



