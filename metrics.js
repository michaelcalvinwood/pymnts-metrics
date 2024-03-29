const listenPort = 6300;
const privateKeyPath = `/etc/ssl-keys/pymnts.com/pymnts.key`;
const fullchainPath = `/etc/ssl-keys/pymnts.com/pymnts.com.pem`;

require('dotenv').config();
const redis = require('redis');
const path = require('path');
const fs = require('fs');
const fsPromise = require('fs/promises');

const express = require('express');
const https = require('https');
const cors = require('cors');

const axios = require('axios');

const cookie = require('cookie');
const { v4: uuidv4 } = require('uuid');

const { REDIS_KEY } = process.env;

const debug = false;

const redisClient = redis.createClient({
    socket: {
        host: 'delta.pymnts.com'
    },
    password: REDIS_KEY
});

redisClient.on('error', err => console.log('Redis redisClient Error', err));
let redisConnected = false;

const purgeTime = 15000;
let bootState = true;
const bootTime = Date.now();
const reconcile = {};
const toRemove = [];

const sleep = async (seconds) => await new Promise(r => setTimeout(r, seconds * 1000));

let currentTime = Math.trunc(Date.now() / 1000);

setInterval(() => {
    currentTime = Math.trunc(Date.now() / 1000);
    //console.log(currentTime);
}, 1000)

const app = express();
app.use(express.static('public'));
app.use(express.json({limit: '500mb'})); 
app.use(cors());



const connectToRedis = async () => {
    try {
        await redisClient.connect();
        redisConnected = true;
        if (debug) {
            console.log('redis connected');
            const test = await redisClient.get('test');
            console.log('test', test);
        }
        // await redisClient.set('test', 'gogo');
        // const value = await redisClient.get('test');
        // console.log('value', value);
      
    } catch (err) {
        console.error(err);
    }
}

const maxDwellTime = 60;

const pathnameToTitle = pathname => {
    if (!pathname) return 'home';
    if (pathname === '/') return 'home';
    
    let title = pathname.substring(0, pathname.length-1);

    const loc = title.lastIndexOf('/');

    if (loc === -1) return title;

    return title.substring(loc + 1);
}

const reportToGA4 = (pathname, userId, timeOnPage, hostname = 'www.pymnts.com') => {
    const g4Id = hostname === 'gamma.pymnts.com' ? 'G-NY60TDWHJ9' : 'G-3WHRCQ5780';
    const apiSecret = hostname === 'gamma.pymnts.com' ? 'LSPWrwHwTyKhghOCL2PqRA' : 'dlnjCX6cQmSqk73YzmIXsg';

    params = {
        api_secret: apiSecret,
        measurement_id: g4Id,
        uc: 'US'
    }

    let data = {
        client_id: 'pymnts_rt_proxy',
        user_id: userId,
        events: [
            {
                name: 'page_view',
                params: {
                    engagement_time_msec: timeOnPage < 30000 ? 30000 : timeOnPage,
                    session_id: uuidv4(),
                    page_location: `https://${hostname}${pathname.indexOf('?') === -1 ? `${pathname}?ppp=true` : `${pathname}&ppp=true`}`,
                    page_path: pathname,
                    page_title: pathnameToTitle(pathname),
                    // page_referrer: referrer
                    
                }
            },
            {
                name: 'pymnts_dnr_proxy',
                params: {
                    blocked_visitor: 1,
                    pathname
                }
            }
        ]
    }

    request = {
        url: "https://www.google-analytics.com/mp/collect",
        method: "post",
        params,
        data
    }

    if (debug) console.log("G4 Request: ", JSON.stringify(request,null, 4));

    axios(request)
    .then(response => console.log('GA4 Success!', userId, pathname))
    .catch(error => console.error('GA4 Error', error));


}

const reportToUA = (pathname, userId, hostname = 'www.pymnts.com') => {
    return new Promise((resolve, reject) => {
        const g3Id = hostname === 'gamma.pymnts.com' ? 'UA-11167465-10' : 'UA-11167465-1';
         /*
         * Send to UA (GA3)
         */
         let params = {
            v: 1,
            t: 'pageview',
            tid: g3Id,
            cid: userId,
            dh: hostname,
            dp: pathname.indexOf('?') === -1 ? `${pathname}?ppp=true` : `${pathname}&ppp=true`,
            dt: pathnameToTitle(pathname),
            // dr: referrer,
            // geoid: getGoogleCode(city, country),
            // ua: userAgent
        }

        let request = {
            url: 'https://www.google-analytics.com/collect',
            method: 'post',
            params
        }

        if (debug) console.log('request', request);
        
        axios(request)
        .then(response => console.log('GA3 Success!', userId, pathname))
        .catch(error => console.error('GA3 Error', error));


        resolve('ok');
    })
}


// process the recorded visits

(async () => {
    let visit;

    while (1) {
        const ips = Object.keys(reconcile);
       
        for (let i = 0; i < ips.length; ++i) {
            let urls = reconcile[ips[i]];
            if (!urls.length) {
                delete reconcile[ips[i]];
                continue;
            }
            const dwellTime = currentTime - urls[0].time;
            
            if (dwellTime >= maxDwellTime) {
                visit = urls.shift();
                const secondsOnPage = urls.length ? Math.abs(urls[0].time - visit.time) : dwellTime;
                //reportToUA(visit.path, visit.userId, 'www.pymnts.com');
                reportToGA4(visit.path, visit.userId, secondsOnPage * 1000, 'www.pymnts.com');
            }

            if (!urls.length) delete reconcile[ips[i]];
        }
        await sleep(.5);
    }
})();

// process removal requests

(async () => {
    while (1) {
        if (toRemove.length && currentTime - toRemove[0].time > Math.trunc(maxDwellTime/2)) {
            const removal = toRemove.shift();
            handleRemoval(removal);
        } else await sleep(.25);
    }
})()

function handleRemoval (removal) {
    
    const {ip, path, time} = removal;

    if (!reconcile[ip]) return;

    if (!reconcile[ip].length) return;

    const index = reconcile[ip].findIndex(entry => entry.path === path);

    //console.log('index', index);

    if (index === -1) return;

    reconcile[ip].splice(index, 1);
    if (!reconcile[ip].length) delete reconcile[ip];
    
    if (debug) {
        console.log('remove', removal.path);
        console.log(reconcile);
    }
}

const getUserId = cookieStr => {
    if (!cookieStr) return uuidv4();

    const cookies = cookie.parse(cookieStr);

    if (cookies['pymnts-device-auth']) {
        console.log('pymnts-device-auth: ', cookies['pymnts-device-auth']);
        return cookies['pymnts-device-auth'];
    }
    if (cookies['pymnts-browser-id']) return cookies['pymnts-browser-id'];
    if (cookies['pymnts-device-identity']) return cookies['pymnts-device-identity'];
    
    return uuidv4();
}

const recordVisit = async (path, pymntsDeviceAuth) => {
    return new Promise((resolve, reject) => {
        const request = {
            url: 'https://tracking.pymnts.com:6200/pageVisit/',
            method: 'post',
            data: {
                path,
                pymntsDeviceAuth
            }
        }
        
        axios(request)
        .then(data => resolve(data))
        .catch(err => resolve('err'));
         
    })
    
}

const processVisitor = async visitorStr => {
    const visitor = JSON.parse(visitorStr);

    if (debug) console.log(visitor);
    const userId = getUserId(visitor.cookie);
    if (debug) console.log('userId', userId);

    const userAgent = visitor.userAgent ? visitor.userAgent.toLowerCase() : '';

    if (!userAgent) return ;

    let test = userAgent.indexOf('google');

    if (test !== -1) return ;

    test = userAgent.indexOf('bot');

    if (test !== -1) return ;

    if (!visitor.path) return;

    const url = new URL(`http://pymnts.com${visitor.path}`);
    //console.log(url);

    const pathname = url.pathname.toLowerCase();
    //console.log(pathname);

    if (pathname.startsWith('/.git')) return;
    if (pathname.startsWith('/wp-content')) return;
    if (pathname.startsWith('/wp-json')) return;
    if (pathname.startsWith('//')) return;
    if (pathname.endsWith('.php')) return;
    
    text = pathname.indexOf('.env');
    if (text !== -1) return;

    let loc = pathname.lastIndexOf('/');
    if (loc === -1 || loc !== pathname.length - 1) {
        loc = pathname.lastIndexOf('.');
        if (loc !== -1) {
            const extension = pathname.substring(loc+1);

            if (extension !== 'html') return;
        }
    }

    let file = path.basename(visitor.path);

    if (file === 'favicon.ico') return ;

    //recordVisit(pathname, userId);

    if (reconcile[visitor.ip] !== undefined) reconcile[visitor.ip].push({path: pathname, time: currentTime, userId})
    else reconcile[visitor.ip] = [{path: pathname, time: currentTime, userId}];

    if (debug) console.log('reconcile', reconcile);
}

const doStuff = async () => {
    await connectToRedis();

    while (true) {
        const visitor = await redisClient.lPop('visitors');
        //if (bootState) console.log('purge', visitor);

        if (visitor && !bootState) await processVisitor(visitor);
        
        if (!visitor) {
            if (bootState) {
                let ts = Date.now();
                if (ts - bootTime > purgeTime) {
                    bootState = false;
                    console.log('BOOT STATE FALSE');
                }
            }
            
            await sleep(2);
        }

    }
}

doStuff(); // This launches the main process

const doNotReport = (req, res) => {
    return new Promise(async (resolve, reject) => {
        let { pathname, ip } = req.body;

        if (!pathname) {
            res.status(400).json('bad request');
            return resolve('error 400: bad request');
        }

        if (!ip) ip = req.socket.remoteAddress;
        if (debug) console.log('Do not report ', ip, pathname);
        
        toRemove.push({
            ip,
            path: pathname,
            time: currentTime
        })

        resolve('ok');
        res.status(200).json('ok');
    })

    
}

app.get('/', (req, res) => {
    res.send('Hello, World!');
});

app.post('/dnr', (req, res) => doNotReport(req, res))

const httpsServer = https.createServer({
    key: fs.readFileSync(privateKeyPath),
    cert: fs.readFileSync(fullchainPath),
  }, app);
  

  httpsServer.listen(listenPort, '0.0.0.0', () => {
    console.log(`HTTPS Server running on port ${listenPort}`);
});

