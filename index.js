'use strict';

var scxml = require('scxml'),
  uuid = require('uuid'),
  request = require('request');

var instances = {};
var instanceSubscriptions = {};

module.exports = function (db, model) {
  var server = {};
  var timeoutMap = {};

  function sendEventToSelf(event, sendUrl){
    var selfUrl = sendUrl || process.env.SEND_URL + event.origin;
    
    var options = {
      method : 'POST',
      json : event,
      url : selfUrl
    };

    console.log('sending event to self', options);

    request(options,function(error, response){
      if(error) console.error('error sending event to server', error || response.body);
    });
  }

  server.createInstance = function (id, done) {
    var instanceId = id || uuid.v1(),
      instance = new scxml.scion.Statechart(model, { 
        customSend: function (event, options, sendUrl, sendEvent) {

          console.log('customSend',event);


          var n;

          switch(event.type) {
            case 'http://www.w3.org/TR/scxml/#SCXMLEventProcessor':
              //normalize to an HTTP event
              //assume this is of the form '/foo/bar/bat'
            case 'http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor':
              if(!event.target) {
                n = function () {
                  sendEventToSelf(event, sendUrl);
                };
              } else {
                n = function(){
                  var options = {
                    method : 'POST',
                    json : event,
                    url : event.target
                  };
                  request(options,function(error, body, response ) {
                    //ignore the response for now
                    //console.log('send response', body);
                  });
                };
              }

              break;

            case 'http://scxml.io/scxmld':
              if(event.target === 'scxml://publish'){
                var subscriptions = instanceSubscriptions[id];
                console.log('subscriptions for instance',id,subscriptions);
                subscriptions.forEach(function(response){
                  console.log('response',response);
                  response.write('event: ' + event.name + '\n');
                  response.write('data: ' + JSON.stringify(event.data) + '\n\n');
                });
              } 
              break;
            default:
              console.log('wrong processor', event.type);
              break;
          }

          var timeoutId = setTimeout(n, options.delay || 0);
          if (options.sendid) timeoutMap[options.sendid] = timeoutId;
        },
        customCancel: function (sendid) {
          clearTimeout(timeoutMap[sendid]);
          delete timeoutMap[sendid];
        },
        sessionid: instanceId 
      });

    instance.id = instanceId;
    
    instances[instance.id] = instance;

    done(null, instance.id);
  };

  server.startInstance = function (id, sendUrl, done) {
    var instance = instances[id];

    instance.start();
    var conf = instance.getSnapshot();

    done(null, conf);
  };

  server.getInstanceSnapshot = function (id, done) {
    var instance = instances[id];

    done(null, instance.getSnapshot());
  };

  server.sendEvent = function (id, event, sendUrl, eventUuid, done, respond) {
    console.log('provider sending event', id, event);
    var instance = instances[id];

    if(!instance) return done({ statusCode: 404 });

    if(event.name === 'system.start') {
      server.startInstance(id, sendUrl, finish);
    } else {
      instance.gen(event);
      var conf = instance.getSnapshot();

      finish(null, conf);
    }

    function finish(err,conf){
      done(null, conf);   //this says it's OK to process the next event
      respond(eventUuid, conf);    //this closes the connection
    }
  };

  server.registerListener = function (id, response, done) {
    var instance = instances[id];

    if(!instance) return done(new Error('Instance not found'));
    
    instanceSubscriptions[id] = instanceSubscriptions[id] || [];

    instanceSubscriptions[id].push(response);

    var listener = {
      onEntry : function(stateId){
        response.write('event: onEntry\n');
        response.write('data: ' + stateId + '\n\n');
      },
      onExit : function(stateId){
        response.write('event: onExit\n');
        response.write('data: ' + stateId + '\n\n');
      }
    };

    instance.registerListener(listener);

    done();
  };

  //This is a much needed interface on instance deletion
  server.unregisterAllListeners = function (id, done) {
    var subscriptions = instanceSubscriptions[id];

    if(!subscriptions) return done();

    subscriptions.forEach(function (response) {
      response.end();
    });

    delete instanceSubscriptions[id];

    if(done) done();
  };

  server.unregisterListener = function (id, response, done) {
    //instanceSubscriptions
    var subscriptions = instanceSubscriptions[id];

    if(!subscriptions) return done();
    //TODO: somehow remove using response object?
    //Any unique identifier in response?
    //http://stackoverflow.com/a/26707009/1744033
    instanceSubscriptions[id] = subscriptions.filter(function (subResponse) {
      if(response.uniqueId === subResponse.uniqueId) {
        response.end();
        return false;
      }

      return true;
    });

    if(done) done();
  };

  server.deleteInstance = function (id, done) {
    delete instances[id];

    done();
  };

  return server;
};
