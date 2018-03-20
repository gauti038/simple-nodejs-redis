var cluster = require("cluster");
var EventEmitter = require('events').EventEmitter;
var errMap = {};
var request = require('request');

if (cluster.isMaster) {
    for (var i = 0; i < require("os").cpus().length; i++) {
        cluster.schedulingPolicy = cluster.SCHED_RR;
        cluster.fork();
    }

    cluster.on("online", function(worker) {
        console.log("Worker " + worker.process.pid + " is online.");
    });

    cluster.on("exit", function(worker, code, signal) {
        console.log("Worker " + worker.process.pid + " died.");
        cluster.schedulingPolicy = cluster.SCHED_RR;
        cluster.fork();
    });
} else if (cluster.isWorker) {

    var express = require("express"),
        app = express(),
        bodyParser = require("body-parser"),
        redis = require("redis"),
        Scripto = require("redis-scripto"),
        os = require("os"),
        sentinel = require("redis-sentinel"),
        poolRedis = require("pool-redis"),
        simpleSentinel = require("simple-sentinel"),
        HashMap = require('hashmap'),
        PropertiesReader = require("properties-reader"),
        properties = PropertiesReader("configuration.config");

    var gateway = properties.get("gateway");
    var portNumber = properties.get("mapPortNumber");
    var redisGetPort = properties.get("mapRedisPort");
    var masterName = properties.get("mapMasterName");
    var maxConnections = properties.get("maxConnections");
    var sentinels = properties.get("sentinels").split(",");

    var redis = require("redis"),
        client = redis.createClient(6379, "redis", {});

    client.on("error", function(err) {
        console.log("Error " + err);
    });

    /*******************/

    var sentinel = require('redis-sentinel'),
        poolRedis = require("pool-redis"),
        simpleSentinel = require("simple-sentinel");

    var endpoints = [{
        host: 'redis-sentinel',
        port: 26379
    }];

    var Sentinel = sentinel.Sentinel(endpoints);
    var masterClient = Sentinel.createClient("redis", {});

    var redisPools = {}
    redisPools["redis"] = {}
    redisPools["redis"][6379] = poolRedis({
        "host": "redis",
        "port": 6379,
        "handleRedisError": true
    });

    var ss = new simpleSentinel(endpoints, {});
    ss.on("change", function(name, replica) {
        var master = replica.getMasterConfig();
        var poolOptions = {};
        poolOptions.host = master.host;
        poolOptions.port = master.port;
        poolOptions.handleRedisError = true;
        redisPools[master.host] = {}
        redisPools[master.host][master.port] = poolRedis(poolOptions);
        var slaves = replica.getAllSlaveConfigs();
        for (var i = 0; i < slaves.length; i++) {
            var poolOptions = {};
            poolOptions.host = slaves[i].host;
            poolOptions.port = slaves[i].port;
            poolOptions.handleRedisError = true;
            if (redisPools[slaves[i].host] == null) redisPools[slaves[i].host] = {}
            redisPools[slaves[i].host][slaves[i].port] = poolRedis(poolOptions);
        }
    });

    app.listen(portNumber);
    app.use(bodyParser.json({
        limit: "1000mb",
        type: "application/*"
    }));
    app.use(bodyParser.urlencoded({
        limit: "1000mb",
        extended: true
    }));
    app.use(function(req, res, next) {
        res.header("Access-Control-Allow-Credentials", true);
        res.header("Access-Control-Allow-Origin", req.headers.origin);
        res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE");
        res.header("Access-Control-Allow-Headers", "Origin, accessToken, userid ,X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept, X    -MAPUID");
        if ("OPTIONS" == req.method) {
            res.sendStatus(200);
        } else next();
    });
    app.use(function(err, req, res, next) {
        handleMalformedJsonError(err, req, res);
    });

    function workerHandlingRequest() {
        console.log("Request Received at: " + new Date());
        console.log("Worker pid: " + cluster.worker.id + " is handling the request");
    }

    getAppDetails();
    var map = new HashMap();

    function getAppDetails() {
            var options = {
                method: 'GET',
                url: 'http://dt-localization-stage.cloudapps.cisco.com/loc/lpc/lpcs/api/applications',
                headers: {
                    remote_user_wsg: 'dft-localization.gen',
                    authorization: 'Basic ZGZ0LWxvY2FsaXphdGlvbi5nZW46TDBjYTFpemF0MTBuTjBuUHJk'
                }
            }
            request(options, function(err, resp) {
                if (err) {
                    conosle.log("error while getting appDetails");
                    return;
                    process.exit(0);
                }
                var details = resp["results"];
                var results = JSON.parse(resp["body"])['results'];
                for (var i = 0; i < results.length; i++) {
                    map.set("" + results[i]["applicationId"] + "", "" + results[i]["applicationShortName"] + "");
                }
                return;
            });
        }
        /*Route: get*/
        /*route to get data from Redis*/
    app.get("/:source(mapx|mapi)/:applicationcontext/data/:dataset", function(req, res) {
        workerHandlingRequest();
        redisGet(req, res);
    });
    /*Route: post*/
    /*route to load or insert data into Redis*/
    app.post("/:source(mapx|mapi)/:applicationcontext/data/:dataset", function(req, res) {
        workerHandlingRequest();
        redisPost(req, res);
    });
    /*Route: delete*/
    /*route to delete objects from Redis*/
    app.delete("/:source(mapx|mapi)/:applicationcontext/data/:dataset", function(req, res) {
        workerHandlingRequest();
        redisDelete(req, res);
    });
    /*Route: delete*/
    /*route to flushall keys from Redis*/
    app.delete("/:source(mapx|mapi)/data/flushall", function(req, res) {
        workerHandlingRequest();
        redisFlushall(req, res);
    });
    /*Route: ping*/
    /*Catches the ping from the load balancer and sends back 200 status*/
    app.get("/", function(req, res) {
        res.status(200);
        res.send("<h1>Hello User !!! </h1>" + os.hostname());
        return;
    });


    function post_call(reply, user_id, key) {
        //var request1 = require("request");
        var applicationName = '';
        var pageSize = 0;
        if (key.indexOf('applicationshortname=') > -1) {
            applicationName = key.split('applicationshortname=')[1].split('&')[0];
        } else if (key.indexOf('applicationid=') > -1) {
            applicationId = key.split('applicationid=')[1].split('&')[0];
            applicationName = map.get(applicationId);
            console.log("appName is ", applicationName);
        } else {
            applicationName = 'CLASS';
        }

        try {
            var content;
            if (reply.length <= 2) {
                content = '';
                pageSize = 0;
            } else {
                content = JSON.parse(reply);
                pageSize = content.count;
            }
            var ae = key.split("?");
            var options = {
                method: 'POST',
                url: 'http://dt-localization-stage.cloudapps.cisco.com/loc/lpc/lpcs/api/metering/measure',
                headers: { //'postman-token': '552d2f4d-66fc-5869-259b-7e19a955bd8e',
                    //'cache-control': 'no-cache',
                    'content-type': 'application/json',
                    remote_user_wsg: 'dft-localization.gen',
                    authorization: 'Basic ZGZ0LWxvY2FsaXphdGlvbi5nZW46TDBjYTFpemF0MTBuTjBuUHJk'
                },
                body: {
                    locMeasureObjType: {
                        applicationName: applicationName,
                        lifeCycleName: 'Map', //hc
                        capabilityName: 'MAP', //hc
                        apiEndpoint: ae[0], //redis-key--hc
                        requestType: 'GET', //hc
                        referenceType: 'RM', //MAP--hc
                        referenceId: '1565', //random
                        requestedUserId: user_id, //dft-localization.gen
                        responseStatus: 'Success', //hc
                        measurementUnit: 'Number', //hc
                        pageSize: pageSize
                    }, //default = 0, si,ei
                    locMeasureResponse: {
                        response: 'Test', //hc
                        requestbody: 'applicationId=713 & userId=AMRKUMBH & sort=CONTENT_ID DESC & type=RESOURCE & versionName=CCWPARTYUI-TS1DMP & stickyVersionFlag=N'
                    }
                },
                json: true
            };
            //var time1 = (new Date()).getTime();
            request(options, function(error, response, body) {
                if (error) console.log("error is ", error);
                // var time2 =(new Date()).getTime();
                //var time3 = time2-time1;
                //console.log("Response: "+time3+"\n");
                console.log(body);
            });
        } catch (err) {
            console.log("error is : " + err);
        }

    }

    /*Gets data from Redis and returns result to user*/
    function redisGet(req, res) {
        var key = req.headers["url"];
        var user_id = req.headers["remote_user_wsg"];
        //console.log("WSG USERS" + user_id);
        if (key == undefined) {
            res.status(404);
            res.send({
                "status": "error",
                "msg": "Please send url as header"
            });
            return;
        }
        var initalTime = new Date().getTime();
        client.get(key, function(err, reply) {
            var redisTime = new Date().getTime();
            console.log("Redis Time" + (redisTime - initalTime));
            if (err) {
                console.log(err);
                res.status(404);
                res.send(err);
                return;
            } else {
                if (reply == null) {
                    res.status(404);
                    res.send({
                        "status": "error",
                        "msg": "No data available for the key"
                    });
                    var url_1 = req.headers["fallbackurl"];
                    console.log("making a call to class API " + url_1);
                    request({
                        method: "GET",
                        url: "http://" + url_1 + "/loc/lpc/lpcs/api" + key,
                        headers: {
                            "Authorization": "Basic ZGZ0LWxvY2FsaXphdGlvbi5nZW46TDBjYTFpemF0MTBuTjBuUHJk",
                            "remote_user_wsg": user_id
                        }
                    }, function(err, result) {
                        if (err) {
                            console.log(err);
                        } else {
                            try {
                                //console.log(result);
                                if (result.statusCode == 200) {
                                    var data = {};
                                    if (key.indexOf('applicationshortname=') > -1) {
                                        req.params.applicationcontext = key.split('applicationshortname=')[1].split('&')[0];
                                    } else if (key.indexOf('applicationid=') > -1) {
                                        req.params.applicationcontext = key.split('applicationid=')[1].split('&')[0];
                                    } else {
                                        req.params.applicationcontext = 'CLASS';
                                    }
                                    console.log("status code from class is " + result.statusCode + ". So storing in redis");
                                    data.url = key;
                                    try {
                                        data.data = JSON.parse(result.body);
                                    } catch (er) {

                                        console.log(er + " JSON parse error for key: " + key);
                                        return;
                                    }
                                    req.headers['ttl'] = 99999999;
                                    req.body = data;
                                    redisPost(req, null);
                                } else if (result.statusCode == 204) {
                                    var data = {};
                                    if (key.indexOf('applicationshortname=') > -1) {
                                        req.params.applicationcontext = key.split('applicationshortname=')[1].split('&')[0];
                                    } else if (key.indexOf('applicationid=') > -1) {
                                        req.params.applicationcontext = key.split('applicationid=')[1].split('&')[0];
                                    } else {
                                        req.params.applicationcontext = 'CLASS';
                                    }
                                    console.log("status code from class is " + result.statusCode + ". So storing {} in redis");
                                    data.url = key;
                                    data.data = '';
                                    req.headers['ttl'] = 99999999;
                                    req.body = data;
                                    redisPost(req, null);
                                } else {
                                    console.log("status code from class is " + result.statusCode + ". So not storing in redis");
                                    return;
                                }

                            } catch (e) {
                                console.log("Error while posting to REDIS : " + e + " for key : " + key);
                                return;
                            }
                        }

                    });
                    return;
                } else {
                    var returnData = JSON.parse(reply);
                    //console.log("returnData is ",returnData , returnData.length, typeof(returnData));
                    if (JSON.parse(reply).length == 0) {
                        res.status(204);
                        res.send("");
                        post_call(reply, user_id, key);
                        return;
                    }
                    res.send(JSON.parse(reply));
                    var serviceTime = new Date().getTime();
                    console.log("Service Time" + (serviceTime - initalTime));
                    post_call(reply, user_id, key);
                    return;
                }
            }
        });

    }



    /*Posts JSON data to Redis*/
    function redisPost(req, res) {
        var body = req.body;
        var url = body['url'];
        var data = body['data'];


        var appName = req.params.applicationcontext;
        var ttl = req.headers['ttl'];

        if (url == undefined || data == undefined || ttl == undefined) {
            res.send({
                "status": "error",
                "msg": "please pass url and data as body and ttl as header"
            });
            return;
        }
        redisPools[masterClient.connectionOption.host][masterClient.connectionOption.port].getClient(function(client, done) {
            //redisPools["localhost"][redisGetPort].getClient(function(client, done) {
            var scriptManager = new Scripto(client);
            scriptManager.loadFromFile("postScript", "lua/post.lua");
            scriptManager.run("postScript", [url, JSON.stringify(data)], [appName, ttl], function(err, result) {
                done();
                if (err) {
                    console.log(err);
                    res.send(err);
                } else if (res != null) {
                    result = JSON.parse(result);
                    if (result["status"] == 'success') {
                        res.send(result);
                        return;
                    } else {
                        res.status(404);
                        res.send(result);
                        return;
                    }
                } else {
                    console.log('data from class updated for key ' + url);
                    return;
                }
            });
        });
    }


    /*Deletes objects from a dataset in Redis based on query string*/
    function redisDelete(req, res) {

        /*Grabs a Redis connection from the connection pull and runs Lua script to Delete data from Redis*/
        redisPools[masterClient.connectionOption.host][masterClient.connectionOption.port].getClient(function(client, done) {
            //redisPools["localhost"][redisGetPort].getClient(function(client, done) {
            var scriptManager = new Scripto(client);
            scriptManager.loadFromFile("deleteScript", "lua/delete.lua");
            scriptManager.run("deleteScript", [req.params.applicationcontext], [], function(err, result) {
                done();
                if (err) {
                    console.log(err);
                    res.send(err);
                    return;
                } else {
                    result = JSON.parse(result);
                    if (result["status"] == 'success') {
                        res.send(result);
                        return;
                    } else {
                        res.status(404);
                        res.send(result);
                        return;
                    }
                }
            });
        });
    }

    /*flushall keys from redis server*/
    function redisFlushall(req, res) {
        /*Grabs a Redis connection from the connection pull and runs Lua script to Delete data from Redis*/
        redisPools[masterClient.connectionOption.host][masterClient.connectionOption.port].getClient(function(client, done) {
            //redisPools["localhost"][redisGetPort].getClient(function(client, done) {
            var scriptManager = new Scripto(client);
            scriptManager.loadFromFile("flushScript", "lua/flushall.lua");
            scriptManager.run("flushScript", [], [], function(err, result) {
                done();
                if (err) {
                    console.log(err);
                    res.send(err);
                    return;
                } else {
                    result = JSON.parse(result);
                    res.send(result);
                }
            });
        });
    }
}
