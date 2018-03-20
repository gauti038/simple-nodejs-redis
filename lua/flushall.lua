local main = function()

  redis.call("FLUSHALL")
  local value = {}
  value["status"] = "success"
  value["msg"] = "deleted"

  local result = cjson.encode(value)
  return result

end

local status, result = pcall(main)
if status then return result
else error(result) end
