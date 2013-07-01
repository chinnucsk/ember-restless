/**
 * Model
 * Base model class for all records
 *
 * @class Model
 * @namespace RESTless
 * @extends Ember.Object
 * @constructor
 */
RESTless.Model = Ember.Object.extend( RESTless.State, Ember.Copyable, {
  /** 
   * id: unique id number, default primary id
   *
   * @property {RESTless.attr}
   */
  id: RESTless.attr('number'),

  /**
   * isNew: model has not yet been saved.
   * When a primary key value is set, isNew becomes false
   *
   * @property {Boolean}
   */
  isNew: true,

  /**
   * _isReady: For internal state management.
   * Model won't be dirtied when setting initial values on create() or load()
   *
   * @private
   * @property {Boolean}
   */
  _isReady: false,

  /**
   * _data: Stores raw model data. Don't use directly; use declared model attributes.
   *
   * @private
   * @property {Object}
   */
  __data: null,
  _data: Ember.computed(function() {
    if (!this.__data) { this.__data = {}; }
    return this.__data;
  }),

  /** 
   * didDefineProperty: Hook to add observers for each attribute/relationship for 'isDirty' functionality
   */
  didDefineProperty: function(proto, key, value) {
    if (value instanceof Ember.Descriptor) {
      var meta = value.meta();

      if (meta.isRelationship) {
        // If a relationship's property becomes dirty, need to mark owner as dirty.
        Ember.addObserver(proto, key + '.isDirty', null, '_onRelationshipChange');
      }
    }
  },

  /**
   * _onPropertyChange: called when any property of the model changes
   * If the model has been loaded, or is new, isDirty flag is set to true.
   * @private
   */
  _onPropertyChange: function(key) {
    var isNew = this.get('isNew');

    // No longer a new record once a primary key is assigned.
    if (isNew && get(this.constructor, 'primaryKey') === key) {
      this.set('isNew', false);
      isNew = false;
    }

    if (this.get('_isReady') && (isNew || this.get('isLoaded'))) {
      this.set('isDirty', true);
    }
  },
  /**
   * _onRelationshipChange: called when a relationship property's isDirty state changes
   * Forwards a _onPropertyChange event for the parent object
   * @private
   */
  _onRelationshipChange: function(sender, key) {
    if(sender.get(key)) { // if isDirty
      this._onPropertyChange(key);
    }
  },

  /**
   * copy: creates a copy of the object. Implements Ember.Copyable protocol
   * http://emberjs.com/api/classes/Ember.Copyable.html#method_copy
   */
  copy: function(deep) {
    var clone = this.constructor.create(),
        fields = get(this.constructor, 'fields');

    Ember.beginPropertyChanges(this);
    fields.forEach(function(field, opts) {
      var value = this.get(field);
      if (value !== null) {
        clone.set(field, value);
      }
    }, this);
    Ember.endPropertyChanges(this);

    return clone;
  },
  /* 
   * copyWithState: creates a copy of the object along with the RESTless.State properties
   */
  copyWithState: function(deep) {
    return this.copyState(this.copy(deep));
  },

  /*
   * create/update/delete methods
   * Forward to the current adapter to perform operations on persistance layer
   */
  saveRecord: function() {
    return RESTless.get('client.adapter').saveRecord(this);
  },
  deleteRecord: function() {
    return RESTless.get('client.adapter').deleteRecord(this);
  },

  /* 
   * serialization methods: Transforms model to and from its data representation.
   * Forward to the current serializer to perform appropriate parsing
   */
  serialize: function() {
    return RESTless.get('client.adapter.serializer').serialize(this);
  },
  deserialize: function(data) {
    return RESTless.get('client.adapter.serializer').deserialize(this, data);
  }
});

/*
 * RESTless.Model (static)
 * Class level properties and methods
 */
RESTless.Model.reopenClass({
  /*
   * create: standard super class create, then marks _isReady state flag
   */
  create: function() {
    var instance = this._super.apply(this, arguments);
    instance.set('_isReady', true);
    return instance;
  },

  /* 
   * primaryKey: property name for the primary key.
   * Configurable. Defaults to 'id'.
   */
  primaryKey: Ember.computed(function() {
    var className = this.toString(),
        modelConfig = get(RESTless, 'client._modelConfigs').get(className);
    if(modelConfig && modelConfig.primaryKey) {
      return modelConfig.primaryKey;
    }
    return 'id';
  }).property('RESTless.client._modelConfigs'),

  /*
   * resourceName: helper to extract name of model subclass
   * App.Post => 'Post', App.PostGroup => 'PostGroup', App.AnotherNamespace.Post => 'Post'
   */
  resourceName: Ember.computed(function() {
    var classNameParts = this.toString().split('.');
    return classNameParts[classNameParts.length-1];
  }),

  /*
   * fields: meta information for all attributes and relationships
   */
  fields: Ember.computed(function() {
    var map = Ember.Map.create();
    this.eachComputedProperty(function(name, meta) {
      if (meta.isAttribute || meta.isRelationship) {
        map.set(name, meta);
      }
    });
    return map;
  }),

  /*
   * find methods: fetch model(s) with specified params
   * Forwards to the current adapter to fetch from the appropriate data layer
   */
  findAll: function() {
    return RESTless.get('client.adapter').findAll(this);
  },
  findQuery: function(params) {
    return RESTless.get('client.adapter').findQuery(this, params);
  },
  findByKey: function(key, params) {
    return RESTless.get('client.adapter').findByKey(this, key, params);
  },
  /*
   * findById: alias to findByKey method
   * Keeps api inline with ember-data.
   * A model's primary key can be customized so findById is not always semantically correct.
   */
  findById: Ember.aliasMethod('findByKey'),
  /*
   * find: a convenience method that can be used
   * to intelligently route to findAll/findQuery/findByKey based on its params
   */
  find: function(params) {
    var primaryKey = get(this, 'primaryKey'),
        singleResourceRequest = typeof params === 'string' || typeof params === 'number' ||
                                (typeof params === 'object' && params.hasOwnProperty(primaryKey));
    if(singleResourceRequest) {
      if(!params.hasOwnProperty(primaryKey)) {
        return this.findByKey(params);
      }
      var key = params[primaryKey];  
      delete params[primaryKey];
      return this.findByKey(key, params);
    } else {
      return this.findQuery(params);
    }
  },

  /*
   * load: Create model directly from data representation.
   */
  load: function(data) {
    return this.create().set('_isReady', false).deserialize(data).setProperties({ _isReady: true, isLoaded: true });
  },
  /*
   * loadMany: Create collection of records directly from data representation.
   */
  loadMany: function(data) {
    return RESTless.RecordArray.createWithContent({ type: this.toString() })
            .deserializeMany(data)
            .set('isLoaded', true);
  }
});
