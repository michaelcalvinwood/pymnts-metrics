const redis = require('redis');
require('dotenv').config();

const { REDIS_KEY } = process.env;

const redisClient = redis.createClient({
    socket: {
        host: 'backdoor.pymnts.com'
    },
    password: REDIS_KEY
});

redisClient.on('error', err => console.log('Redis redisClient Error', err));

async function redisTest() {
    await redisClient.connect();
    
    await redisClient.set('test', 'yoyo');
    const value = await redisClient.get('test');
    console.log('value', value);
    await redisClient.disconnect();
}

redisTest();