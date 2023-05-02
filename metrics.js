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



const { REDIS_KEY } = process.env;

const redisClient = redis.createClient({
    socket: {
        host: 'gamma.pymnts.com'
    },
    password: REDIS_KEY
});

redisClient.on('error', err => console.log('Redis redisClient Error', err));
let redisConnected = false;

const reconcile = {};



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
   
        // await redisClient.set('test', 'gogo');
        // const value = await redisClient.get('test');
        // console.log('value', value);
      
    } catch (err) {
        console.error(err);
    }
}

const maxDwellTime = 5;

const processEntries = async () => {
    let visit;

    while (1) {
        const ips = Object.keys(reconcile);
       
        for (let i = 0; i < ips.length; ++i) {
            let urls = reconcile[ips[i]];
            if (!urls.length) delete reconcile[ips[i]];

            const dwellTime = currentTime - urls[0].time;
            
            if (dwellTime >= maxDwellTime) {
                visit = urls.shift();
                console.log("report to Google", visit);
            }

            if (!urls.length) delete reconcile[ips[i]];
        }
        await sleep(1);
    }


}
processEntries();

const processVisitor = async visitorStr => {
    const visitor = JSON.parse(visitorStr);

    const userAgent = visitor.userAgent.toLowerCase();

    if (!userAgent) return ;

    let test = userAgent.indexOf('google');

    if (test !== -1) return ;

    test = userAgent.indexOf('bot');

    if (test !== -1) return ;

    let file = path.basename(visitor.path);

    if (file === 'favicon.ico') return ;

    if (reconcile[visitor.ip] !== undefined) reconcile[visitor.ip].push({path: visitor.path, time: currentTime})
    else reconcile[visitor.ip] = [{path: visitor.path, time: currentTime}];
}

const doStuff = async () => {
    await connectToRedis();

    while (true) {
        const visitor = await redisClient.lPop('visitors');
        if (visitor) await processVisitor(visitor);
        else {
            await sleep(2);
        }

    }
}

doStuff();

app.get('/', (req, res) => {
    res.send('Hello, World!');
});

const httpsServer = https.createServer({
    key: fs.readFileSync(privateKeyPath),
    cert: fs.readFileSync(fullchainPath),
  }, app);
  

  httpsServer.listen(listenPort, '0.0.0.0', () => {
    console.log(`HTTPS Server running on port ${listenPort}`);
});

