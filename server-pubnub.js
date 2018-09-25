var express = require('express');
var bodyParser = require('body-parser');
var methodOverride = require("method-override");
var PubNub = require('pubnub');
var cors = require('cors');
var https = require('https');
var http = require('http');
var fs = require('fs');
var app = express();

// Middlewares
app.use(bodyParser.urlencoded({ extended: false })); 
app.use(bodyParser.json()); 
app.use(methodOverride());
app.use(cors());

var router = express.Router();
var channel = 'random-tracker-map';
var center_point = [40.439921, -3.694739];//Madrid

var torchys = [];
var torchys_length = 0;
var segment_speed = [];
var intersections = [];
var intersections_index = [];
var intersections_length = [];


var simbol = [-1,+1];
var max_devices = 64;
var initial_devices = 30;
var radio = 10 * 1000;
var round_index = initial_devices;

var max_range = 0.0540;//10 km variation
var div_by = 18.5;

var refresh_time = 3800;

var map_mode = [];
map_mode["driving"] = "directions/v5/mapbox/driving/";
map_mode["cycling"] = "directions/v5/mapbox/cycling/";
map_mode["walking"] = "directions/v5/mapbox/walking/";

var speed_map = [];
speed_map["driving"] = 4;
speed_map["cycling"] = 3;
speed_map["walking"] = 2;

var mapbox_token = '[token]';

var walkers = fs.readFileSync("walkers.json");
walkers = JSON.parse(walkers);

var options = {
	protocol: 'https:',	
    host: 'https://api.mapbox.com/',
    port: 443,
    method: 'GET',
    headers: {
        'Content-Type': 'application/json'
    }
};

var blocked = false;

function getRandomSimbol() {
	var random = Math.floor(Math.random()*10);
	if(random>1) return getRandomSimbol();
	return random;
}

function getRandomPoint() {
	var point = JSON.parse(JSON.stringify(center_point));	
	var t0 = Math.random();
	var t1 = Math.random();
	var u0 = (t0 / div_by);
	var u1 = (t1 / div_by);	
	var v0 = u0 * simbol[getRandomSimbol()];
	var v1 = u1 * simbol[getRandomSimbol()];	
	point[0] += v0;
	point[1] += v1;
	return point;	
}

function distanceCoord(lat1, lon1, lat2, lon2, unit) {
	var radlat1 = Math.PI * lat1/180
	var radlat2 = Math.PI * lat2/180
	var theta = lon1-lon2
	var radtheta = Math.PI * theta/180
	var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
	dist = Math.acos(dist)
	dist = dist * 180/Math.PI
	dist = dist * 60 * 1.1515
	if (unit=="K") { dist = dist * 1.609344 }
	else if (unit=="N") { dist = dist * 0.8684 }
	else if (unit=="M") { dist = (dist * 1.609344) * 1000.0000000 }
	return dist;
}

function swap(array) {
	var temp = array[0];
	array[0] = array[1];
	array[1] = temp;
}

function doGenericGet(path, index, handler) {
	https.get(path, (res) => {
		
		if(res.statusCode == 200) {
			var output = "";
		 	res.on('data', (d) => { output += d.toString('utf8'); });
		
			res.on('end', function() {
				var obj = JSON.parse(output);
				handler(obj, index);
        	});
		}
  		res.resume();
	}).on('error', (e) => {
  		console.log(`Got error: ${e.message}`);
	});	
}

function getSourceHandler(obj, index) {
	var name = obj.features[0].place_name;
	if(!name)name = obj.features[0].text; 
	torchys[index].source = name;
}


function getDestinyHandler(obj, index) {
	var name = obj.features[0].place_name;				
	if(!name)name = obj.features[0].text; 
	torchys[index].destiny = name;
}

function getIntersectionsHandler(obj, index) {
	if(!obj || !obj.routes || obj.routes.length == 0 || 
	   !obj.routes[0].legs || obj.routes[0].legs == 0 || 
	    !obj.routes[0].legs[0].steps) return ;
	
	var steps= obj.routes[0].legs[0].steps;
				
	var c = 0;
	segment_speed[index] = [];
	intersections[index] = [];
				
	for(var I = 0; I < steps.length; I++) {					
		var speed = 1;
		if(steps[I].duration != 0 && steps[I].distance != 0) speed = steps[I].distance / steps[I].duration;
					
		for(var J = 0; J < steps[I].intersections.length; J++) {
			segment_speed[index][c] = speed;
			intersections[index][c] = steps[I].intersections[J].location;
			swap(intersections[index][c++]);
		}
	}				
	intersections_length[index] = c;				
	intersections_index[index] = 0;		
	
}

function getIntersections(index) {
	var obj = torchys[index];
	var path = obj.from[1]+","+obj.from[0]+";"+obj.to[1]+","+obj.to[0]+"?"+"steps=true&access_token=" + mapbox_token;
		
	var mode = map_mode[obj.mode];	
	torchys[index].speed_plus = speed_map[obj.mode];
	
	path = options.host + mode + path;

	doGenericGet(path, index, getIntersectionsHandler);
	
}

var mapBoxEndPoint = "https://api.mapbox.com/geocoding/v5/mapbox.places/";
var accessToken = ".json?access_token=";

function pairInit(I) {
	var pathS = mapBoxEndPoint + torchys[I].from[1] + "," + torchys[I].from[0] + accessToken + mapbox_token;
	var pathD = mapBoxEndPoint + torchys[I].to[1] + "," + torchys[I].to[0] + accessToken + mapbox_token;
			
	doGenericGet(pathS, I, getSourceHandler);
	doGenericGet(pathD, I, getDestinyHandler);
	getIntersections(I);
}

function initialization() {
	torchys_length = 0;
	round_index = initial_devices;
	
	for(var I = 0; I < 17; I++) {
		intersections_index[I] = 0;
		intersections_length[I] = 0;
		var from = getRandomPoint();
		var to = getRandomPoint();
	
		torchys[I] = { 
			from: from, 
			to: to,
			name: "Line " + (I + 1), 
			mode: "driving"
		};
		
		pairInit(I);		
		torchys_length++;		
	}	
	
	for(var I = 17; I < 22; I++) {
		intersections_index[I] = 0;
		intersections_length[I] = 0;
		var from = getRandomPoint();
		var to = getRandomPoint();
	
		torchys[I] = { 
			from: from, 
			to: to,
			name: "Cycling " + (I + 1),
			mode: "cycling"
		};
		
		pairInit(I);		
		torchys_length++;		
	}	
	
	for(var I = 22; I < initial_devices; I++) {
		intersections_index[I] = 0;
		intersections_length[I] = 0;
		var from = getRandomPoint();
		var to = getRandomPoint();
	
		torchys[I] = { 
			from: from, 
			to: to,
			name: walkers[I-22].name,
			mode: "walking",
			img: walkers[I-22].img
		};
		
		pairInit(I);		
		torchys_length++;		
	}	
	
}

initialization();

pubnub = new PubNub({
                publishKey : 'pub-nub-publish-key',
                subscribeKey : 'pub-nub-subscriber-key'
        });

var exit = false;

function checkTime(timeout) {
	setTimeout(function() {
		blocked = true;
		
		while(exit == false) {
			//Waiting
		}
		
		exit = false;
		initialization();			
		blocked = false;
		updateCoordinates(10*1000);		
		checkTime(timeout);		
	},timeout); 
	
}

//checkTime(1000*60*3);

function updateCoordinates(timeout) {
	if(blocked == true) {
		exit = true;
		return;
	}
	
	setTimeout(function() {
		
		var toShow = []
		
		for (var I = 0; I < torchys_length; I++) {
			
			var ii = intersections_index[I];
			
			var currentTorchy = { 
				data: {
					source: torchys[I].source,
					destiny: torchys[I].destiny,
					mode: torchys[I].mode,
					color: torchys[I].color,
					name: torchys[I].name,
					img: torchys[I].img,
				}				
			};
						
			if(ii == 0) {
				currentTorchy.latlng = intersections[I][ii];							
				intersections_index[I]++;
			}
			else if(ii == intersections_length[I]) {
				intersections_index[I] = 0;
				torchys[I].from = torchys[I].to;
				torchys[I].to = getRandomPoint();
				pairInit(I);
				currentTorchy.latlng = torchys[I].from;
				//getIntersections(I);
			}
			else {
				var prev = intersections[I][ii - 1];
				var current = intersections[I][ii];				
				var speed = Math.max(segment_speed[I][ii], segment_speed[I][ii - 1]);
				speed *= torchys[I].speed_plus;
				var distance = distanceCoord(current[0],current[1], prev[0], prev[1], 'M');
				var time = distance / speed;								
				var ndistance = ((refresh_time/1000) * distance) / time; 
				
				if(distance < 1 || ndistance > distance || time == 0) {
					currentTorchy.latlng = current; 
					intersections_index[I]++;
				} else {
					var factor = ndistance / distance;					
					var latv = current[0] - prev[0];
					var lngv = current[1] - prev[1];

					latv *= factor;
					lngv *= factor;
					
					prev[0] += latv;
					prev[1] += lngv;
					
					intersections[I][ii - 1] = prev;
					currentTorchy.latlng = prev;
				}				
				
			}			
			
			toShow.push(currentTorchy);
		}
		
		pubnub.publish({channel: channel,message: toShow});
		updateCoordinates(refresh_time);
	}, timeout);	
}

updateCoordinates(10*1000,false);

router.get('/get-devices', function(req, res) { 
	res.send(JSON.stringify(torchys));
});


router.post('/add-device', function(req, res) { 
	var response = {};
	response.data = "Ok";
	response.success = true;	
	if(torchys_length == max_devices) {
		round_index = ((round_index+1) % (max_devices - initial_devices)) + initial_devices;
		torchys[round_index] = req.body;
		pairInit(round_index);
	} else {
		torchys[torchys_length++] = req.body;
		pairInit(torchys_length-1);
	}
		
	res.send(response);
});


app.use(router);

app.listen(3000, function() {
 console.log("Node server running on http://localhost:3000");
});

setTimeout(function() {
        http.get('http://localhost:3000/get-devices', (res) => {
                if(res.statusCode == 200) {}
                res.resume();
        }).on('error', (e) => {});

},1000*60*60);
