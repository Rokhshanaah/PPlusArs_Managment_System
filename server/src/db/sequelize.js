import { Sequelize } from 'sequelize';
import { env } from '../config/env.js';
export const sequelize=new Sequelize(env.dbName,env.dbUser,env.dbPassword,{dialect:'mysql',host:env.dbHost,port:env.dbPort,logging:env.dbLogging?console.log:false,define:{underscored:true,freezeTableName:true},pool:{max:10,min:0,acquire:30000,idle:10000},dialectOptions:{decimalNumbers:true}});
