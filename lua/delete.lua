local appName = KEYS[1]

--main function
local main = function()
	
	if redis.call("EXISTS", "MAP:"..appName) == 1 then 
		local urlLen = redis.call("HLEN", "MAP:"..appName)
		for i=1,urlLen,1 do
			local tempurl = redis.call("HGET", "MAP:"..appName, i)
			redis.call("DEL", tempurl)
	    end
	    redis.call("DEL", "MAP:"..appName)

	    local value = {}
	    value["status"] = "success"
	    value["msg"] = "data deleted successfully for application "..appName
	    
	    local result = cjson.encode(value)
  		return result 
  	end

  		local value = {}
	    value["status"] = "error"
	    value["msg"] = "No data exists for application "..appName
	    
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