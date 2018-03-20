local url = KEYS[1]
local data = KEYS[2]

local appName = ARGV[1]
local expiryTime = ARGV[2]

--main function
local main = function()

	if redis.call("EXISTS", url) == 1 then
		local value = {}
		value["status"] = "error"
		value["msg"] = "same url already exists, delete that first"
		local result = cjson.encode(value)
  		return result 
	end 

	redis.call("SET", url, data)
	redis.call("EXPIRE", url, expiryTime)

	local count = redis.call("HLEN", "MAP:"..appName)
	local newCount = count + 1

	redis.call("HSET", "MAP:"..appName, newCount, url)
	redis.call("EXPIRE", "MAP:"..appName, expiryTime)
	
	local value = {}

	value["status"] = "success"
	value["appUrlCount"] = newCount

	local result = cjson.encode(value)
  	return result 
	
end

local status, result = pcall(main)
if status then return result
else error(result) end



--[[if redis.call("EXISTS", "MAP:"..appName) == 1 then 
		local appKeys = redis.call("HGETALL", "MAP:"..appName)
		for i=1,#appKeys,2 do
			local tempurl = redis.call("HGET", "MAP:"..appName, i)
			redis.call("DELETE", tempurl)
	    end
	    redis.call("DELETE", "MAP:"..appName)
  	end--]]