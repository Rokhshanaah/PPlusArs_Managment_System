import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading } from './Common.jsx';
export default function ProtectedRoute({children}){const {user,loading}=useAuth();if(loading)return <Loading/>;return user?children:<Navigate to="/login" replace/>}
