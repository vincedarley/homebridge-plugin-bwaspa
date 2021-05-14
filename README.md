
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

<span align="center">

# Homebridge Balboa Spa Plugin
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins) [![npm](https://badgen.net/npm/dt/homebridge-balboa-spa?color=purple)](https://www.npmjs.com/package/homebridge-balboa-spa)

</span>

This plugin will connect to Spas/Hot-tubs via their Balboa wifi module, and expose a set of controls (pumps, lights, etc) and the spa temperature, and temperature control thermostat, in HomeKit.  It also exposes a "Leak Sensor" which acts as a sensor for whether the heater water flow in the spa is all good.  You can set that up in Home to send you a notification if anything goes wrong.

The plugin does a good job of ensuring the state of all controls remains in sync whether you manipulate the controls through Home, through Siri, through physical controls on the spa, or through the Balboa spa app, and takes account of situations (e.g. during filtering) where some pumps cannot be turned off.

The default behaviour is for the plugin to discover your Spa automatically on your network, query it for all supported controls and make them all available to Homekit automatically.  You can modify much of that behaviour by configuring the plugin with Homebridge ConfigUI.  And of course you can rename or delete accessories in Home to serve your purposes. Finally the plugin will automatically correct the time of day of your spa, useful when daylight savings kicks in.

<p align="left">
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/home.png" height="400"></a>
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/thermostat.png" height="400"></a>
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/pump.png" height="400"></a>
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/lights.png" height="400"></a>
</p>

# Getting started

Install everything:
1. Follow the step-by-step instructions on the [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki) to install Homebridge.
2. Follow the step-by-step instructions on the [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x/wiki) to install Homebridge Config UI X.
3. Install homebridge-balboa-spa using: `npm install -g homebridge-balboa-spa` or search for `Balboa Spa` in Config UI X.

Restart homebridge so it reloads the new plugin.  Click through to the Balboa Spa plugin settings

<p align="center">
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/plugin.png" height="154"></a>
</p>

With a typical setup, there is nothing more you need to do (if you wish you can specify your Spa's model name). Everything should be automatic. However, you can manually specify the IP address and the particular set of controls you want to make available if you wish (or in particular if your spa cannot be automatically discovered on your network - you'll see errors in the log if that is the case). Click save and restart homebridge so the changes take effect.

<p align="center">
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/settings.png" height="400"></a>
</p>



# More details on supported accessories

This section details how this plugin translates the Spa's controls and settings into the world
of accessories and devices that Homekit provides...

It supports pumps that are single speed (off or high) and 2-speed (off or low or high). The pump control sliders in Home then step accordingly (0-100% or 0-50%-100%).  Since Homekit doesn't have a notion of a multi-speed jet/pump, they are all treated as "fans" by Home.

You can control two lights and up to six pumps, a mister, a blower, 2 aux devices and the overall heating state of the spa. You can also view the state of the circulation pump.

The "Thermostat" device type exposes control of the spa's target temperature and high (="Heat" in Home app) vs low (="Cool" in Home app), heating mode.  The low mode is generally used as a low-energy vacation mode. The target temperature is separate for the two modes and the valid ranges are also different.  If the flow sensor indicates water flow has failed, then the thermostat is "off".  You cannot turn it off yourself - it is not a valid state for the spa itself.

The Spa's current temperature is visible both in the Thermostat device and in the read-only Temperature Sensor. Up to you if you want/need both devices.

The flow sensor has 3 states: normal (all good), failed (which triggers a "leak" alarm - and you should be able to configure Home to send you a notification when this happens), or low water flow which triggers a status fault with the sensor.  This is useful to alert you if filters need cleaning (when they are dirty the flow slows/fails, heating is turned off, and the spa cools down).  The Balboa mobile app doesn't alert you to any problems with water flow, so this capability is very helpful. 

There is a "Hold" switch to activate the Spa's hold mode (temporarily turn off all pumps, including the circulation pump, so that you can safely change filters, etc).

There are two "Locks" - to lock the spa settings (while still allowing control over pumps, lights, etc) and to lock the Spa completely (preventing use of any panel controls until unlocked). These
are the same locking/unlocking as Balboa provides in the Spa control panel.

Finally there are other devices on some spas: a "blower" (typically with 3-speeds), a "mister" and two auxiliary devices (aux1 and aux2).  They are all supported by this plugin, but not yet fully tested (please test them and report back on success or any problems).

## Siri

If you give your accessories good names, Siri works very well. You may need to consider the
fact that Siri understands your jets/pumps as "fans".  Also in english, "two" and "to" sound the same and I find Siri has trouble therefore with "Jet two".  But overall it works pretty well.

<p align="left">
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/siri-jet.png" height="400"></a>
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/siri-temperature.png" height="400"></a>
</p>


## Here are some sample configs

The default config handles everything automatically:
```
        {
            "autoCreateAccessories": true,
            "name": "Spa",
            "platform": "Balboa-Spa"
        }
```
In this case your homebridge log should end up containing lines like these, which show successful automatic spa discovery, connection and pump/light/etc configuration discovery and accessory creation.  You can then add these to Home and organise/rename them as you wish.
```
[Spa] Discovered a Spa at 192.168.1.151
[Spa] Successfully connected to Spa at 192.168.1.151 on port 4257
[Spa] Discovered 3 pumps with speeds [ 2, 2, 1, 0, 0, 0 ]
[Spa] Discovered 1 light
[Spa] Discovered other components: circulation-pump true , blower 0 , mister undefined , aux [ false, false ]
[Spa] Autocreating accessories...
[Spa] Pump 1 has 2 speeds.
[Spa] Pump 2 has 2 speeds.
[Spa] Pump 3 has 1 speeds.
```

However, if you wish to, or need to, make some manual adjustments, you can provide (or create via Config UI) a more elaborate config, for example:
```
{
            "name": "MasterSpa MP7",
            "autoCreateAccessories": false,
            "host": "192.168.1.151",
            "devices": [
                {
                    "name": "Pump 1",
                    "deviceType": "Pump 1"
                },
                {
                    "name": "Pump 2",
                    "deviceType": "Pump 2"
                },
                {
                    "name": "Pump 3",
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

Lights are simply on/off.  Balboa provide no current capability to control the colour.  So this limitation cannot be rectified, unless Balboa enhance their product.

If the water flow sensor discovers a fault (which it checks for every ten minutes), and you then fix the issue (change/clean filters, etc), the spa does not actually notify that the fault has been corrected. However if you either use 'hold' mode or turn the spa off/on (which you should generally do when changing filters) then a hold or priming event will take precedence and through this plugin the fault will no longer be reported to Homekit. If you don't do either of those actions, then the fault will only be reset in Homekit the following day.

## Reliability

There's a fair amount of information on the internet of how the Balboa Wifi module is pretty unreliable.  In particular prior to the '-06' release of the '50350' module, it would regularly disconnect and then be unable to reconnect (without rebooting the power supply to the module).  With my own spa, the module is adequately reliable but even then does disconnect for a few minutes to an hour once every day or two, sometimes as often as a few times a day.  But between the module and this plugin's reconnect capability, a reconnection does always ultimately happen.  If your Spa's module is less reliable, I would suggest a first step is to check which module version you have.

Whilst the spa is disconnected, obviously all Homekit controls will fail. However the plugin is clever enough to store the
major ones (adjusting thermostat, hold, lock status) and will re-apply them once the connection is re-established.

## Improvements

If you wish to help with any further improvements, pleasre report any problems, and please take a look in the homebridge log for lines like this:

```
[My Hot Tub] Control types reply(0a,bf,2e):1a,00,01,90,00,00
[My Hot Tub] Discovered 3 pumps with speeds [ 2, 2, 1, 0, 0, 0 ]
[My Hot Tub] Discovered 1 light
[My Hot Tub] Discovered other components: circ_pump true , blower false , mister false , aux [ false, false ]
[My Hot Tub] Control Panel reply 1:14,00,01,1e,88,00,01,1e
[My Hot Tub] First filter time from 20:00 for 01:30
[My Hot Tub] Second filter time on from 08:00 for 01:30
[My Hot Tub] ControlPanelRequest2 Sending:7e,08,0a,bf,22,02,00,00,89,7e
[My Hot Tub] Control Panel reply 2:64,e1,24,00,4d,53,34,30,45,20,20,20,01,c3,47,96,36,03,0a,44,00
[My Hot Tub] System Model MS40E   
[My Hot Tub] SoftwareID (SSID) M100_225 V36
[My Hot Tub] Current Setup 1
[My Hot Tub] Configuration Signature C3479636
[My Hot Tub] ControlPanelRequest3 Sending:7e,08,0a,bf,22,04,00,00,f4,7e
[My Hot Tub] Control Panel reply 3:05,01,32,63,50,68,61,07,41
[My Hot Tub] ControlPanelRequest4 Sending:7e,08,0a,bf,22,08,00,00,0e,7e
[My Hot Tub] Control Panel reply 4:00,85,00,01,01,02,00,00,00,00,00,00,00,00,00,00,00,00
[My Hot Tub] Checking for any Spa faults Sending:7e,08,0a,bf,22,20,ff,00,cb,7e
[My Hot Tub] No recent faults. Last fault 1 days ago of type M019 = priming (this is not actually a fault - your Spa was recently turned on) with details from log: Fault Entries: 24 Num: 24 Error code: 19 Days ago: 1 Time: 18:35 Heat mode: 24 Set temp: 38 Temp A: 38 Temp B: 38
[My Hot Tub] ConfigRequest Sending:7e,05,0a,bf,04,77,7e
[My Hot Tub] Config reply with MAC address (0a,bf,94):02,14,80,00,15,27,3f,9b,95,00,00,00,00,00,00,00,00,00,15,27,ff,ff,3f,9b,95
```

and submit those details (which will probably contain slightly different numbers) in [this issue](https://github.com/vincedarley/homebridge-plugin-bwaspa/issues/1) on github, along with the physical configuration of your spa (number of pumps, speed settings, etc). Hopefully with a bit more data we can ensure everything is interpreted correctly, if it isn't already.  The above, for example, shows that my Spa has 3 pumps, where Pump 1 is 2-speed, Pump 2 is 2-speed and Pump 3 is 1-speed. And my Spa has 1 light. This was all therefore discovered correctly.

The Spa can report many more faults/errors (some completely critical) beyond the water flow problems mentioned above. The plugin code currently ignores all other errors - it does report them in the log, but nothing more.

If you have more than one Spa, with minor modifications this plugin could happily handle that situation - please submit a bug report (and/or try to make the code changes yourself).

It looks like it might be possible to move the Flow sensor to a pair of "Filter Condition", "Filter life" settings on the thermostat. Might be a slightly better fit for Homekit's approach.

## Other related work

[Here you can read about](https://github.com/ccutrer/balboa_worldwide_app/wiki) other related work on controlling Balboa spas - including some work to understand the direct protocols the spa uses so that e.g. a raspberry pi could be used instead of the unreliable Balboa wifi module.

## Thanks

The homebridge plugin template project was the basis for this, and some Python code for connecting to balboa helped a lot in education about the communication protocols.  The node-red/MQTT/Balboa implementation served as some inspiration, but I really wanted something simpler to install and configure, and customise more precisely to deal with things like faults and temperature controls and multi-speed pumps, and with close to 100% accuracy of synchronisation between Spa state and Home state. Hence writing this plugin.

