import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CustomersPage from './pages/CustomersPage.jsx';
import CustomerLedgerPage from './pages/CustomerLedgerPage.jsx';
import CustomerPortalPage from './pages/CustomerPortalPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import CurrenciesPage from './pages/CurrenciesPage.jsx';
import RatesPage from './pages/RatesPage.jsx';
import MoneyPage from './pages/MoneyPage.jsx';
import RemittancesPage from './pages/RemittancesPage.jsx';
import CashboxesPage from './pages/CashboxesPage.jsx';
import BalancePage from './pages/BalancePage.jsx';
import JournalPage from './pages/JournalPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import IncomeStatementPage from './pages/IncomeStatementPage.jsx';
import BranchesPage from './pages/BranchesPage.jsx';
import StaffPage from './pages/StaffPage.jsx';
import MessagesPage from './pages/MessagesPage.jsx';
import CardReaderPage from './pages/CardReaderPage.jsx';
import ReceiptsWithdrawalsPage from './pages/ReceiptsWithdrawalsPage.jsx';
import ExpensesPage from './pages/ExpensesPage.jsx';
import AuditPage from './pages/AuditPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ReceiptPage from './pages/ReceiptPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/c/:token" element={<CustomerPortalPage />} />
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id/ledger" element={<CustomerLedgerPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="card-reader" element={<CardReaderPage />} />
        <Route path="receipts-withdrawals" element={<ReceiptsWithdrawalsPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="currencies" element={<CurrenciesPage />} />
        <Route path="rates" element={<RatesPage />} />
        <Route path="buy" element={<MoneyPage kind="buy" />} />
        <Route path="sell" element={<MoneyPage kind="sell" />} />
        <Route path="exchange" element={<MoneyPage kind="exchange" />} />
        <Route path="remittances" element={<RemittancesPage />} />
        <Route path="cashboxes" element={<CashboxesPage />} />
        <Route path="balance" element={<BalancePage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="journal" element={<JournalPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="profit-loss" element={<IncomeStatementPage />} />
        <Route path="branches" element={<BranchesPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="transactions/:id/receipt" element={<ReceiptPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
