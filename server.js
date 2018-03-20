var cluster = require("cluster");
if (cluster.isMaster) {
    for (var i = 0; i < require("os").cpus().length; i++) {
        cluster.fork();
    }

    cluster.on("online", function(worker) {
        console.log("Worker " + worker.process.pid + " is online.");
    });

    cluster.on("exit", function(worker, code, signal) {
        console.log("Worker " + worker.process.pid + " died.");
        cluster.fork();
    });
} else {
    var sentinel = require('redis-sentinel'),
        poolRedis = require("pool-redis"),
        simpleSentinel = require("simple-sentinel"),
        express = require("express"),
      	app = express(),
        redis = require("redis"),
      	Scripto = require ("redis-scripto"),
        request = require('request'),
        HashMap = require('hashmap'),
        bodyParser = require("body-parser");

    var map = new HashMap();

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

    var redis = require("redis"),
        redisClient = redis.createClient(6379, "redis", {});

     redisClient.on("error", function(err) {
         console.log("Error " + err);
     });

    app.listen(9090);


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
        res.header("Access-Control-Allow-Headers", "Origin, accessToken, userid ,X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept, X-MAPUID");
        if ("OPTIONS" == req.method) {
            res.sendStatus(200);
        } else next();
    });


    function workerHandlingRequest() {
        console.log("Worker pid: " + cluster.worker.id + " received request at : " + new Date());
    }

    getAppDetails();

    function getAppDetails() {
        var options = {
            method: 'GET',
            url: 'http://dt-localization-prod.cloudapps.cisco.com/loc/lpc/lpcs/api/applications',
            headers: {
                remote_user_wsg: 'dft-localization.gen',
                authorization: 'Basic ZGZ0LWxvY2FsaXphdGlvbi5nZW46TDBjYTFpemF0MTBu'
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
            console.log("data inserted into hashMap..");
            return;
        });
    }

    app.get("/",function (req,res) {
      console.log("called", new Date());
      res.send("Called at : "+ new Date());
      return;
    });

    function postMeteringData(reply, userId, key) {
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
        var content;
        if (reply.length <= 2) {
            content = '';
            pageSize = 0;
        } else {
            content = JSON.parse(reply);
            pageSize = content.count;
        }
        var options = {
            method: 'POST',
            url: 'http://dt-localization-prod.cloudapps.cisco.com/loc/lpc/lpcs/api/metering/measure',
            headers: {
                'content-type': 'application/json',
                remote_user_wsg: 'dft-localization.gen',
                authorization: 'Basic ZGZ0LWxvY2FsaXphdGlvbi5nZW46TDBjYTFpemF0MTBu'
            },
            body: {
                    locMeasureObjType: {
                        applicationName: applicationName,
                        lifeCycleName: 'Map', //hc
                        capabilityName: 'MAP', //hc
                        apiEndpoint: key.split("?")[0], //redis-key--hc
                        requestType: 'GET', //hc
                        referenceType: 'RM', //MAP--hc
                        referenceId: '1565', //random
                        requestedUserId: userId, //dft-localization.gen
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
        request(options, function(error, response, body) {
            if (error) console.log("error is ", error);
            console.log(body);
        });
    }

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

    function redisGet(req, res) {
        var key = req.headers["url"];
        var userId = req.headers["remote_user_wsg"];
        if (key == undefined) {
            res.status(404);
            res.send({"status": "error", "msg": "Please send url as header"});
            return;
        }
        redisClient.get(key, function(err, reply) {
            if (err) {
                console.log(err);
                res.status(404);
                res.send(err);
                return;
            } else {
                if (reply == null) {
                    res.status(404);
                    res.send({"status": "error","msg": "No data available for the key"});
                    fetchData(req, key);
                    return;
                } else {
                    var returnData = JSON.parse(reply);
                    if (JSON.parse(reply).length == 0) {
                        res.status(204);
                        res.send("");
                        postMeteringData(reply, userId, key);
                        return;
                    }
                    res.send(JSON.parse(reply));
                    postMeteringData(reply, userId, key);
                    return;
                }
            }
        });

    }

    function fetchData(req, key) {
        var remoteUserWsg = req.headers["remote_user_wsg"];
        var fallBackUrl = req.headers["fallbackurl"];
        request({
            method: "GET",
            url: "http://" + fallBackUrl + "/loc/lpc/lpcs/api" + key,
            headers: {
                "Authorization": "Basic ZGZ0LWxvY2FsaXphdGlvbi5nZW46TDBjYTFpemF0MTBu",
                "remote_user_wsg": remoteUserWsg
            }
        }, function(err, result) {
            if (err) {
                console.log("Error while fetching data from CLASS ur " + fallbackurl + ". Error is :  " + err);
                return;
            } else {
                if (result.statusCode == 200 || result.statusCode == 204) {
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
                    if (result.statusCode == 200) {
                        data.data = JSON.parse(result.body);
                    } else {
                        data.data = '';
                    }
                    req.headers['ttl'] = 99999999;
                    req.body = data;
                    redisPost(req, null);
                    return;
                } else {
                    console.log("status code from class is " + result.statusCode + ". So not storing in redis");
                    return;
                }
            }

        });
    }

    function redisPost(req, res) {
        var body = req.body;
        var url = body['url'];
        var data = body['data'];
        var appName = req.params.applicationcontext;
        var ttl = req.headers['ttl'];

        if (url == undefined || data == undefined || ttl == undefined) {
            res.send({"status": "error","msg": "please pass url and data as body and ttl as header"});
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
        /*Grabs a Redis connection from the connection pool and runs Lua script to Delete data from Redis*/
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
