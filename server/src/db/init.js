import bcrypt from 'bcryptjs';
import { sequelize } from './sequelize.js';
import { ensureDatabaseExists } from './ensureDatabase.js';
import { ensureSchema } from './ensureSchema.js';
import { Currency, User, SystemSetting, Branch, Cashbox } from '../models/index.js';
import currencies from '../data/currencies.json' with { type: 'json' };
import { ensureDefaultCustomer } from '../utils/defaultCustomer.js';
import { parseAppPlan } from '../utils/appPlans.js';
export const allPermissions=['dashboard','customers','accounts','currencies','rates','buy','sell','exchange','remittances','cashboxes','balance','expenses','reports','branches','staff','audit','settings'];
export async function initializeDatabase(){
  await ensureDatabaseExists();
  await sequelize.authenticate();
  await sequelize.sync();
  await ensureSchema();
  const [admin]=await User.unscoped().findOrCreate({where:{username:'admin'},defaults:{name:'مدیر کل',phone:'0700000000',password:await bcrypt.hash('12345678',12),role:'مدیر کل',permissions:allPermissions,isActive:true}});
  const adminPerms = Array.isArray(admin.permissions) ? admin.permissions : [];
  const mergedPerms = [...new Set([...adminPerms, ...allPermissions])];
  if (!admin.permissions || mergedPerms.length !== adminPerms.length) {
    await admin.update({ permissions: mergedPerms });
  }
  const settings={company_name:'PPlus.Arz',company_slogan:'بخش مدیریتی صرافی چند پولی',company_phone:'0700000000',company_email:'',company_whatsapp:'',company_address:'افغانستان',public_app_url:'',large_transaction_limit:'10000',default_fee:'0',receipt_copies:'1',session_timeout_minutes:'60',numbering_start:'1',receipt_note:'رسید بدون مهر و امضا اعتبار ندارد.',daily_backup:'روشن',manager_approval:'روشن',show_profit_on_receipt:'خاموش',auto_print_receipt:'خاموش',allow_negative_cashbox:'خاموش',print_card_reader_photo:'خاموش',print_card_reader_fingerprint:'خاموش',trade_show_rate_field:'خاموش',whatsapp_enabled:'روشن',whatsapp_send_mode:'simple',whatsapp_phone_number_id:'',whatsapp_access_token:'',whatsapp_api_version:'v21.0',whatsapp_webhook_verify_token:'zarin-whatsapp-verify',whatsapp_template_name:'',whatsapp_template_lang:'fa',whatsapp_default_country_code:'93',whatsapp_notify_transactions:'روشن',whatsapp_notify_ledger:'روشن',whatsapp_notify_remittances:'روشن',whatsapp_notify_convert:'روشن',whatsapp_message_template:'PPlus.Arz\n[عنوان رسید]\nنام مشتری : [نام مشتری]\nتاریخ [تاریخ]\n[بدهی قبلی] [مبلغ قبلی] [ارز]\n[نوع مبلغ] : [مبلغ] [ارز]\nالباقی حساب [الباقی] [حروف] [ارز]',customer_portal_language:'fa',customer_portal_menus:'dashboard,accounts,messages',app_plan:'premium',app_enabled_menus:parseAppPlan('premium').menus.join(','),telegram_bot_token:'',telegram_chat_id:'',telegram_backup_enabled:'خاموش'};
  await Promise.all(Object.entries(settings).map(([settingKey,settingValue])=>SystemSetting.findOrCreate({where:{settingKey},defaults:{settingValue}})));
  if(await Currency.count()===0)await Currency.bulkCreate(currencies.map(c=>({...c,sign:c.symbol,isActive:true,isBase:c.code==='AFN'})));
  if(await Branch.count()===0){const branch=await Branch.create({name:'شعبه مرکزی',city:'کابل',address:'افغانستان',isActive:true});await Cashbox.create({branchId:branch.id,name:'صندوق مرکزی',keeperName:'مدیر',isActive:true});}
  await ensureDefaultCustomer();
  return sequelize;
}
