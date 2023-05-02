const redis = require('redis');
require('dotenv').config();

const { REDIS_KEY } = process.env;

const redisClient = redis.createClient({
    socket: {
        host: 'gamma.pymnts.com'
    },
    password: REDIS_KEY
});

redisClient.on('error', err => console.log('Redis redisClient Error', err));
let redisConnected = false;

const sleep = async (seconds) => await new Promise(r => setTimeout(r, seconds * 1000));

let currentTime = Math.trunc(Date.now() / 1000);

setInterval(() => {
    currentTime = Math.trunc(Date.now() / 1000);
    //console.log(currentTime);
}, 1000)

console.log(currentTime);

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

const processVisitor = async visitorStr => {
    const visitor = JSON.parse(visitorStr);

    const userAgent = visitor.userAgent.toLowerCase();

    if (!userAgent) return console.log('rejected null userAgent');

    let test = userAgent.indexOf('google');

    if (test !== -1) return console.log('rejected google');

    test = userAgent.indexOf('bot');

    if (test !== -1) return console.log('rejected bot');

    console.log(visitor);
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


