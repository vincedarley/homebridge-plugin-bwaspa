
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


# Homebridge Balboa Spa Plugin

This plugin will connect some Balboa Spas over their wifi, and expose a set of controls (pumps, lights) and its temperature, and temperature control, in HomeKit.  It also exposes a "Leak Sensor" which acts as a sensor for whether the heater water flow in the spa is all good.  You can set that up in Home to send you a notification if anything goes wrong.

Configure the plugin with Homebridge ConfigUI

## Here is a sample config

```
{
            "name": "My Hot Tub",
            "host": "192.168.1.151",
            "devices": [
                {
                    "name": "Pump 1",
                    "pumpRange": 2,
                    "deviceType": "Pump 1"
                },
                {
                    "name": "Pump 2",
                    "pumpRange": 2,
                    "deviceType": "Pump 2"
                },
                {
                    "name": "Pump 3",
                    "pumpRange": 1,
                    "deviceType": "Pump 3"
                },
                {
                    "name": "Spa Lights",
                    "deviceType": "Lights 1"
                },
                {
                    "name": "Spa Temperature",
                    "deviceType": "Temperature Sensor"
                },
                {
                    "name": "Temperature Control",
                    "deviceType": "Thermostat"
                },
                {
                    "name": "Flow",
                    "deviceType": "Water Flow Problem Sensor"
                }
            ],
            "platform": "Balboa-Spa"
        }
```

It supports pumps that are single speed (off or high) and 2-speed (off or low or high).

## Limitations?

You can control two lights and up to 4 pumps. The code does not know how many pumps or lights your spa has - you define that in the items you set up in your config. (I believe it would be possible to automate this, see the improvements section below).
The second set of lights is currently untested (please report if it works or not).

The pumps have a 'minStep' of 50% or 100% depending on their number of speed settings that you define in the config.

Lights are simply on/off.  Balboa provide no capability to control the colour.  So this limitation will never be rectified.

The "Thermostat" device type exposes control of the spa's target temperature and high (="HEAT" in Home app) vs low (="Cool" in Home app), heating mode.  The target temperature is separate for the two modes
and the valid ranges are also different.  If the flow sensor indicates water flow has failed, then the thermostat is "off".  You cannot turn it off yourself - it is not a valid state for the spa itself.

The Spa's current temperature is visible both in the Thermostat device and in the read-only Temperature Sensor. Up to you if you want/need both devices.

The flow sensor has 3 states: normal (all good), failed (which triggers a "leak" alarm - and you should be able to configure Home to send you a notification when this happens), or low water flow which triggers a status fault with the sensor.  This is useful to alert you if filters need cleaning (when they are dirty the flow slows/fails, heating is turned off, and the spa cools down).  The Balboa app doesn't alert you to any problems there, so this capability is very useful. Currently the sensor code only updates once an hour.  So even when you fix the issue (change filters, reset spa, etc) it won't reset in Homekit for some time without you manually restarting homebridge - this could be improved in the code in the future.

## Improvements

If you wish to help on either of the above potential automations, please take a look in the homebridge log for lines like this:

```
[My Hot Tub] ControlConfigRequest Writing:7e,08,0a,bf,22,02,00,00,89,7e
[My Hot Tub] Control config 1 reply: 100,225,36,0,77,83,52,48,69,32,32,32,1,195,71,150,54,3,10,68,0

[My Hot Tub] ConfigRequest Writing:7e,05,0a,bf,04,77,7e
[My Hot Tub] Config reply: 2,20,128,0,21,39,63,155,149,0,0,0,0,0,0,0,0,0,21,39,255,255,63,155,149
```

and submit those details (which will probably contain slightly different numbers) in an issue on github, along with the physical configuration of your spa (number of pumps, speed settings, etc). Hopefully with a bit more data we can interpret the above successfully.

## Thanks

The homebridge plugin template project was the basis for this, and some Python code for connecting to balboa helped a lot in education about the communication protocols.  The node-red/MQTT/Balboa implementation served as some inspiration, but I really wanted something simpler to install and configure, and customise more precisely to deal with things like faults and temperature controls.

My first Typescript or Homebridge project...