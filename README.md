
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# Homebridge Balboa Spa Plugin

This plugin will connect some Balboa Spas over their wifi, and expose a set of controls (pumps, lights) and its temperature, and temperature control, in HomeKit.  It also exposes a "Leak Sensor" which acts as a sensor for whether the heater water flow in the spa is all good.  You can set that up in Home to send you a notification if anything goes wrong.

Configure the plugin with Homebridge ConfigUI

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

# More details on supported accessories

It supports pumps that are single speed (off or high) and 2-speed (off or low or high) - you can define that in the config. The pump control sliders in Home then have a 'minStep' of 50% or 100% depending on their number of speed settings.

You can control two lights and up to six pumps. 

The "Thermostat" device type exposes control of the spa's target temperature and high (="HEAT" in Home app) vs low (="Cool" in Home app), heating mode.  The target temperature is separate for the two modes and the valid ranges are also different.  If the flow sensor indicates water flow has failed, then the thermostat is "off".  You cannot turn it off yourself - it is not a valid state for the spa itself.

The Spa's current temperature is visible both in the Thermostat device and in the read-only Temperature Sensor. Up to you if you want/need both devices.

The flow sensor has 3 states: normal (all good), failed (which triggers a "leak" alarm - and you should be able to configure Home to send you a notification when this happens), or low water flow which triggers a status fault with the sensor.  This is useful to alert you if filters need cleaning (when they are dirty the flow slows/fails, heating is turned off, and the spa cools down).  The Balboa mobile app doesn't alert you to any problems with water flow, so this capability is very helpful. 

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

## Limitations?

Pumps 4-6 and lights 2 are currently untested (please report if they work for you or not).

The code has the ability to automatically determine know how many pumps (and their speed options) and lights your spa has - but, for the moment you still define that in the items you set up in your config. It would be helpful if you could validate that the automatic sensing is correct (see below).
If you try to define things that don't exist, the controller will reject them - add a toplevel config '"ignoreAutomaticConfiguration" : true' to not do this.

Lights are simply on/off.  Balboa provide no capability to control the colour.  So this limitation will never be rectified.

Currently the water flow sensor code updates once every ten minutes, and the Spa does not actually report that water flow has been corrected, so the latest fault will still be present.  So even when you fix the issue (change/clean filters, etc) it won't reset in Homekit until the next day.  If you turn the spa on/off, then a priming event will take precedence and Homekit will then no longer report the flow problem.

Some spas have a "blower" or a "mister". No support for those at present.

## Improvements

If you wish to help on further automation of pump/light configuration, please take a look in the homebridge log for lines like this:

```
[My Hot Tub] ControlPanelRequest Sending:7e,08,0a,bf,22,00,00,01,58,7e
[My Hot Tub] Control panel reply(0a,bf,2e):1a,00,01,90,00,00
[My Hot Tub] Discovered 3 pumps with speeds [ 2, 2, 1, 0, 0, 0 ]
[My Hot Tub] Discovered lights: [ true, false ] circ_pump true blower false mister false aux [ false, false ]

[My Hot Tub] ConfigRequest Writing:7e,05,0a,bf,04,77,7e
[My Hot Tub] Config reply(0a,bf,94):02,14,80,00,15,27,3f,9b,95,00,00,00,00,00,00,00,00,00,15,27,ff,ff,3f,9b,95
```

and submit those details (which will probably contain slightly different numbers) in [this issue](https://github.com/vincedarley/homebridge-plugin-bwaspa/issues/1) on github, along with the physical configuration of your spa (number of pumps, speed settings, etc). Hopefully with a bit more data we can ensure everything is interpreted correctly.  The above, for example, shows that my Spa has 3 pumps, where Pump 1 is 2-speed, Pump 2 is 2-speed and Pump 3 is 1-speed. And my Spa has 1 light. This was all therefore discovered correctly.

## Thanks

The homebridge plugin template project was the basis for this, and some Python code for connecting to balboa helped a lot in education about the communication protocols.  The node-red/MQTT/Balboa implementation served as some inspiration, but I really wanted something simpler to install and configure, and customise more precisely to deal with things like faults and temperature controls.

My first Typescript or Homebridge project...