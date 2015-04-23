'use strict';

var scxml = require('scxml'),
  fs = require('fs'),
  path = require('path'),
  uuid = require('uuid'),
  rmdir = require('rimraf'),
  tar = require('tar');


var models = {};
var instances = {};
var tmpFolder = 'tmp';

module.exports = function () {
  var server = {};
  
  //Delete old temp folder
  //Create temporary folder for tar streams  
  rmdir.sync(tmpFolder);
  fs.mkdir(tmpFolder);

  server.createStatechartWithTar = function (chartName, pack, done) {
    var statechartFolder = path.join(tmpFolder, chartName);

    rmdir(statechartFolder, function (err) {
      if(err) return done(err);

      fs.mkdir(statechartFolder, function () {
        var extractor = tar.Extract({path: statechartFolder })
          .on('error', function (err) { done(err); })
          .on('end', function () {
            var mainFilePath = path.resolve(path.join(statechartFolder, 'index.scxml'));

            scxml.pathToModel(mainFilePath, function (err, model) {
              models[chartName] = model;

              done(err);
            });
          });

        //Route tar stream to our file system and finalize
        pack.pipe(extractor);
        pack.finalize();
      });
    });
  };

  server.createStatechart = function (chartName, scxmlString, done) {
    scxml.documentStringToModel(null, scxmlString, function (err, model) {
      models[chartName] = model;

      done(err);
    });
  };

  server.createInstance = function (chartName, id, done) {
    var instanceId = chartName + '/' + (id || uuid.v1()),
      instance = new scxml.scion.Statechart(models[chartName], { sessionid: instanceId });

    instance.id = instanceId;
    
    instances[instance.id] = instance;

    done(null, instance.id);
  };

  server.startInstance = function (id, done) {
    var instance = instances[id];

    var conf = instance.start();

    done(null, conf);
  };

  server.getInstanceSnapshot = function (id, done) {
    var instance = instances[id];

    done(null, instance.getSnapshot());
  };

  server.sendEvent = function (id, event, done) {
    var instance = instances[id];

    var conf = instance.gen(event);

    done(null, conf);
  };

  server.registerListener = function (id, response, done) {
    var instance = instances[id];

    instance.listener = {
      onEntry : function(stateId){
        response.write('event: onEntry\n');
        response.write('data: ' + stateId + '\n\n');
      },
      onExit : function(stateId){
        response.write('event: onExit\n');
        response.write('data: ' + stateId + '\n\n');
      }
      //TODO: spec this out
      // onTransition : function(sourceStateId,targetStatesIds){}
    };

    instance.registerListener(instance.listener);

    done();
  };

  server.unregisterListener = function (id, done) {
    var instance = instances[id];
    
    if (instance) 
      instance.unregisterListener(instance.listener);

    if(done) done();
  };

  server.deleteStatechart = function (chartName, done) {
    var success = delete models[chartName];

    done(null, success);
  };

  server.deleteInstance = function (id, done) {
    delete instances[id];

    done();
  };

  return server;
};
