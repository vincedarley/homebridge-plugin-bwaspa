import * as udp from 'dgram';
import type { Logger } from 'homebridge';

/**
 * Try to find a Spa on the network automatically, using UDP broadcast
 * @param log 
 * @param foundSpaCallback call with the ip address of any Spa found on the network
 */
export function discoverSpas(log: Logger, foundSpaCallback: (ip: string) => void) {
    var discoveryFunction = () => {
        // creating a client socket
        const client = udp.createSocket({ type: 'udp4', reuseAddr: true });

        let host = '255.255.255.255';
        // Balboa Wifi module listens on this port.
        let port = 30303;
        let timeout = 10000;

        client.on('message', (msg: any, info: any) => {
            log.debug('UDP Data received from server :', msg.toString());
            log.debug('UDP Received %d bytes from %s:%d', msg.length, info.address, info.port);
            if (msg.length >= 6 && msg.slice(0,6) == 'BWGSPA') {
                log.info('Discovered a Spa at', info.address);
                // Cancel the repeated tries - we've found the spa.
                clearInterval(broadcastIntervalId);
                foundSpaCallback(info.address);
            }
        });

        //buffer msg - doesn't really matter what we send
        const data = Buffer.from('Discovery: Who is out there?');

        // I don't fully understand this line, but it is essential to this function working.
        client.bind(() => {
            client.setBroadcast(true);
        });

        //sending msg
        client.send(data, port, host, (error: any) => {
            if (error) {
                log.warn(error);
                client.close();
            } else {
                log.debug('UDP discovery broadcast message sent - attempting to find a spa');
            }
        });
        
        setTimeout(() => {
            log.debug('No spa found - waiting to retry');
            client.close()
        }, timeout);
        
    };

    // Try every 20 seconds to discover the Spa, waiting 10 seconds each time for a response.
    let broadcastIntervalId = setInterval(discoveryFunction, 20 * 1000);
    // But start immediately.
    discoveryFunction();

}

