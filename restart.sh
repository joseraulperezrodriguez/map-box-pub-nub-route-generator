#!/bin/bash
pkill -f server-pubnub
cd /opt/nodejs/nodejs_code/
nohup node server-pubnub.js >> log.txt &
